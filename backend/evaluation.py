"""Evaluate supplied labels; keep invalid references visible and unscored."""
import json
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from threading import Lock

import numpy as np
import pandas as pd

from .matcher import DEFAULT_MODE, SCORING_MODES, FAQMatcher, MODEL_NAME

TEST_FILES = {
    'original': ('Original queries', 'semantic_faq_test_queries.csv', True),
    'additional': ('Additional queries', 'semantic_faq_additional_test_queries.csv', True),
    'unrelated': ('Unrelated queries', 'semantic_faq_no_match_test_queries.csv', False),
    # Held-out sets written independently from the FAQ list only (see docs/validation.md).
    'holdout': ('Held-out queries', 'semantic_faq_holdout_test_queries.csv', True),
    'holdout_unrelated': ('Held-out unrelated', 'semantic_faq_holdout_no_match_queries.csv', False),
}


def load_test_files(data_dir: Path) -> dict[str, tuple[str, str, bool]]:
    """Test sets for a dataset: its datasets.json manifest if present, else the default set list."""
    manifest = data_dir / 'datasets.json'
    if manifest.is_file():
        return {item['key']: (item['name'], item['filename'], bool(item['labeled']))
                for item in json.loads(manifest.read_text())}
    return dict(TEST_FILES)


def rate(values: list[bool]) -> float | None:
    return sum(values) / len(values) if values else None


class Evaluator:
    def __init__(self, matcher: FAQMatcher, data_dir: Path):
        self.matcher = matcher
        self.data_dir = data_dir
        self._lock = Lock()
        self._cache: list[dict] | None = None
        self.test_files = load_test_files(data_dir)
        self.unlabeled = {key for key, (_, _, labeled) in self.test_files.items() if not labeled}
        self._embeddings: dict[str, object] = {}

    def embed(self, filename: str, queries: list[str]):
        """Query embeddings per test file. They don't change when the matcher learns,
        so they are kept across invalidations."""
        cached = self._embeddings.get(filename)
        if cached is None or len(cached) != len(queries):
            # Encode in chunks so live searches can take the model lock in between.
            chunks = [self.matcher.encode_queries(queries[i:i + 1024]) for i in range(0, len(queries), 1024)]
            cached = self._embeddings[filename] = np.vstack(chunks) if chunks else np.zeros((0, 384))
        return cached

    def warm_up(self) -> None:
        """Pre-compute test-set embeddings and rankings so the first evaluation is instant."""
        try:
            with self._lock:
                self._ranked()
        except Exception:  # never let a warm-up failure affect the running app
            pass

    def invalidate(self) -> None:
        """Drop cached rankings, e.g. after the matcher learns a new phrasing."""
        with self._lock:
            self._cache = None

    def inventory(self) -> list[dict]:
        inventory = []
        for key, (name, filename, labeled) in self.test_files.items():
            path = self.data_dir / filename
            inventory.append(dict(key=key, name=name, filename=filename, labeled=labeled,
                                  available=path.is_file(),
                                  count=len(self._load(path, labeled)) if path.is_file() else 0))
        return inventory

    def _load(self, path: Path, labeled: bool) -> list[dict]:
        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        required = {'user_query', 'expected_faq_id'} if labeled else {'user_query'}
        if not required.issubset(frame.columns):
            raise ValueError(f'{path.name} requires columns: {sorted(required)}')
        for field in required:
            frame[field] = frame[field].str.strip()
            if (frame[field] == '').any():
                raise ValueError(f'{path.name} has empty {field} values.')
        if labeled:
            frame['expected_faq_id'] = frame['expected_faq_id'].str.upper()
        return frame.to_dict(orient='records')

    def _ranked(self) -> list[dict]:
        if self._cache is None:
            self._cache = self._rank_all()
        return self._cache

    def _rank_all(self) -> list[dict]:
        ids = {faq.faq_id for faq in self.matcher.faqs}
        records = []
        for key, (_, filename, labeled) in self.test_files.items():
            path = self.data_dir / filename
            if not path.is_file():
                continue
            rows = self._load(path, labeled)
            queries = [row['user_query'] for row in rows]
            matches = self.matcher.rank_many(queries, embeddings=self.embed(filename, queries))
            for row, candidates in zip(rows, matches):
                expected = row.get('expected_faq_id')
                records.append(dict(dataset=key, query=row['user_query'], expected_faq_id=expected,
                                    valid_label=expected in ids if labeled else True,
                                    candidates=[c.faq_id for c in candidates], score=candidates[0].score))
        return records

    def run(self, threshold: float) -> dict:
        # Protect first cache fill; scores are immutable for this process's data snapshot.
        with self._lock:
            ranked = self._ranked()
        rows = []
        for row in ranked:
            prediction = row['candidates'][0] if row['score'] >= threshold else None
            expected = row['expected_faq_id']
            valid = row['valid_label']
            rows.append({**row, 'predicted_faq_id': prediction,
                         'top1_correct': row['candidates'][0] == expected if valid and expected else None,
                         'top3_correct': expected in row['candidates'] if valid and expected else None,
                         'correct': prediction == expected if valid else None})
        summaries = []
        for info in self.inventory():
            group = [r for r in rows if r['dataset'] == info['key']]
            valid = [r for r in group if r['valid_label']]
            summaries.append({**info, 'valid_count': len(valid),
                              'invalid_count': len(group) - len(valid),
                              'top1_accuracy': rate([r['top1_correct'] for r in valid]) if info['labeled'] else None,
                              'top3_accuracy': rate([r['top3_correct'] for r in valid]) if info['labeled'] else None,
                              'accepted_accuracy': rate([r['correct'] for r in valid]) if info['labeled'] else None,
                              'rejection_rate': rate([r['predicted_faq_id'] is None for r in valid]) if not info['labeled'] else None,
                              'false_accepts': sum(r['predicted_faq_id'] is not None for r in valid) if not info['labeled'] else None})
        sweep = []
        for t in [round(i / 100, 2) for i in range(20, 81, 5)]:
            labeled = [r for r in ranked if r['expected_faq_id'] and r['valid_label']]
            unrelated = [r for r in ranked if r['dataset'] in self.unlabeled]
            sweep.append(dict(threshold=t,
                              correct_match_rate=rate([r['score'] >= t and r['candidates'][0] == r['expected_faq_id'] for r in labeled]),
                              rejection_rate=rate([r['score'] < t for r in unrelated])))
        counts = Counter(r['query'].strip().lower() for r in rows)
        return dict(threshold=threshold, model=MODEL_NAME, learned_phrasings=self.matcher.learned_count,
                    measured_at=datetime.now(timezone.utc).isoformat(),
                    datasets=summaries, rows=rows, threshold_sweep=sweep,
                    duplicate_query_rows=sum(n - 1 for n in counts.values()),
                    test_sha256={f: sha256((self.data_dir / f).read_bytes()).hexdigest()
                                 for _, f, _ in self.test_files.values() if (self.data_dir / f).is_file()})


MODE_LABELS = {
    'keyword': 'Keyword search only (BM25)',
    'semantic': 'Semantic only (cosine)',
    'overlap': 'Semantic 0.85 + token overlap 0.15',
    'bm25': 'Semantic 0.85 + BM25 0.15',
}


def compare_modes(evaluator: 'Evaluator', threshold: float) -> dict:
    """Score every test set under each scoring mode, reusing one embedding pass per set.
    Also reports category-prediction accuracy (centroid vs. top-1 FAQ's category)."""
    matcher = evaluator.matcher
    ids = {faq.faq_id: faq for faq in matcher.faqs}
    sets = []
    for key, (name, filename, labeled) in evaluator.test_files.items():
        path = evaluator.data_dir / filename
        if path.is_file():
            rows = evaluator._load(path, labeled)
            embeddings = evaluator.embed(filename, [r['user_query'] for r in rows])
            if labeled:
                keep = [i for i, r in enumerate(rows) if r['expected_faq_id'] in ids]
                rows, embeddings = [rows[i] for i in keep], embeddings[keep]
            sets.append((key, name, labeled, rows, embeddings))
    results, default_ranked = [], {}
    for mode in ('keyword', 'semantic', 'overlap', 'bm25'):
        per_set = []
        for key, name, labeled, rows, embeddings in sets:
            ranked = matcher.rank_many([r['user_query'] for r in rows], mode=mode, embeddings=embeddings)
            if mode == DEFAULT_MODE:
                default_ranked[key] = ranked
            if labeled:
                expected = [r['expected_faq_id'] for r in rows]
                per_set.append(dict(key=key, name=name, labeled=True, count=len(rows),
                    top1=rate([c[0].faq_id == e for c, e in zip(ranked, expected)]),
                    top3=rate([e in [x.faq_id for x in c] for c, e in zip(ranked, expected)]),
                    accepted=None if mode == 'keyword' else rate([c[0].faq_id == e and c[0].score >= threshold for c, e in zip(ranked, expected)]),
                    rejection=None))
            else:
                per_set.append(dict(key=key, name=name, labeled=False, count=len(rows), top1=None, top3=None, accepted=None,
                    rejection=None if mode == 'keyword' else rate([c[0].score < threshold for c in ranked])))
        results.append(dict(mode=mode, label=MODE_LABELS[mode], default=mode == DEFAULT_MODE, sets=per_set))
    categories = []
    for key, name, labeled, rows, embeddings in sets:
        if not labeled:
            continue
        truth = [ids[r['expected_faq_id']].category for r in rows]
        centroid = [p[0][0] for p in matcher.predict_categories(embeddings, k=1)]
        top_faq = [c[0].category for c in default_ranked[key]]
        categories.append(dict(key=key, name=name, count=len(rows),
                               centroid_accuracy=rate([a == b for a, b in zip(centroid, truth)]),
                               top_faq_accuracy=rate([a == b for a, b in zip(top_faq, truth)])))
    return dict(threshold=threshold, default_mode=DEFAULT_MODE, modes=results, categories=categories,
                category_count=len(matcher.categories))
