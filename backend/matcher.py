"""Semantic FAQ ranking, with FAQ embeddings computed once per process.

Each FAQ is represented by its canonical question, its curated alternate phrasings,
and any phrasings learned from user feedback. A query is scored against every
phrasing and each FAQ keeps its best phrasing.
"""
import csv
import os
import re
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from time import perf_counter

import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

from .repository import FAQRepository
from .schemas import Candidate, CategoryScore, MatchResponse

MODEL_NAME = 'all-MiniLM-L6-v2'
SIMILARITY_THRESHOLD = 0.45
SEMANTIC_WEIGHT = 0.85
KEYWORD_WEIGHT = 0.15
HIGH_CONFIDENCE = 0.70      # accepted matches at or above this score are "high" confidence
AMBIGUITY_MARGIN = 0.04     # two accepted candidates closer than this are "ambiguous"

# Keyword term of the hybrid score. 'bm25' and its constants were chosen on the supplied
# (original + additional) test sets only; the held-out set is reserved for reporting.
SCORING_MODES = ('bm25', 'overlap', 'semantic', 'keyword')
DEFAULT_MODE = os.getenv('FAQ_SCORING_MODE', 'bm25')
BM25_SATURATION = 10.0      # bm25 / (bm25 + c) maps raw BM25 into [0, 1) without per-query rescaling

# Function words carry no topic signal; dropping them stops "how do I ..." from
# inflating keyword overlap between unrelated questions. Negations are kept.
STOPWORDS = frozenset('''
a an the and or but if so of to in on at by for from with about into over after before
i me my mine we us our you your yours it its this that these those there here
is am are was were be been being do does did doing have has had having
can could will would shall should may might must
how what when where why which who whom whose
please hi hello thanks thank just also any some get got
s t d ll m re ve
'''.split())


def tokenize(text: str) -> set[str]:
    return set(re.findall(r'\b[a-z0-9]+\b', text.lower()))


def bm25_tokens(text: str) -> list[str]:
    """Token list (with repeats) for BM25; stopwords removed unless nothing remains."""
    words = re.findall(r'\b[a-z0-9]+\b', text.lower())
    return [w for w in words if w not in STOPWORDS] or words


def content_tokens(text: str) -> set[str]:
    """Tokens without stopwords; falls back to all tokens if nothing remains."""
    tokens = tokenize(text)
    return (tokens - STOPWORDS) or tokens


@dataclass(frozen=True)
class _Index:
    """Immutable snapshot of all phrasings, swapped atomically when the matcher learns."""
    phrasings: tuple[str, ...]
    sources: tuple[str, ...]            # 'question' | 'alternate' | 'learned'
    owners: np.ndarray                  # FAQ index of each phrasing
    embeddings: np.ndarray
    word_sets: tuple[frozenset, ...]
    group_ends: np.ndarray              # cumulative phrasing count per FAQ (for lexsort grouping)
    bm25: BM25Okapi                     # one BM25 document per FAQ: all of its phrasings


class FAQMatcher:
    def __init__(self, repository: FAQRepository, model=None, learned_path: Path | None = None):
        self.faqs = repository.load()
        self.faq_index = {faq.faq_id: i for i, faq in enumerate(self.faqs)}
        self.model = model if model is not None else SentenceTransformer(
            MODEL_NAME, device=os.getenv('FAQ_DEVICE', 'cpu'),
            local_files_only=os.getenv('FAQ_LOCAL_FILES_ONLY', '0') == '1',
        )
        self.learned_path = learned_path
        self._lock = Lock()
        texts, owners, sources = [], [], []
        for index, faq in enumerate(self.faqs):
            for source, items in (('question', [faq.question]), ('alternate', faq.alternate_questions)):
                for text in items:
                    texts.append(text); owners.append(index); sources.append(source)
        for faq_id, text in self._read_learned():
            texts.append(text); owners.append(self.faq_index[faq_id]); sources.append('learned')
        self._base_count = sum(s != 'learned' for s in sources)
        self._index = self._build(texts, owners, sources, self._encode(texts))
        self._map = None
        self._category_vectors = None
        self.categories = sorted({f.category for f in self.faqs})

    # ----- index construction -------------------------------------------------
    def _encode(self, texts: list[str]) -> np.ndarray:
        with self._lock:
            return self.model.encode(texts, normalize_embeddings=True, convert_to_numpy=True,
                                     show_progress_bar=False)

    def _build(self, texts, owners, sources, embeddings) -> _Index:
        owners = np.asarray(owners)
        documents: list[list[str]] = [[] for _ in self.faqs]
        for text, owner in zip(texts, owners):
            documents[int(owner)].extend(bm25_tokens(text))
        return _Index(tuple(texts), tuple(sources), owners, np.asarray(embeddings),
                      tuple(frozenset(content_tokens(t)) for t in texts),
                      np.cumsum(np.bincount(owners, minlength=len(self.faqs))), BM25Okapi(documents))

    def _read_learned(self) -> list[tuple[str, str]]:
        if not self.learned_path or not self.learned_path.is_file():
            return []
        with self.learned_path.open(newline='') as stream:
            rows = [(r['faq_id'].strip().upper(), r['query'].strip()) for r in csv.DictReader(stream)]
        return [(faq_id, text) for faq_id, text in rows if faq_id in self.faq_index and text]

    # ----- public properties --------------------------------------------------
    @property
    def phrasings(self) -> tuple[str, ...]:
        return self._index.phrasings

    @property
    def embeddings(self) -> np.ndarray:
        return self._index.embeddings

    @property
    def phrasing_count(self) -> int:
        return len(self._index.phrasings)

    @property
    def learned_count(self) -> int:
        return self.phrasing_count - self._base_count

    def learned_phrasings(self) -> list[dict]:
        index = self._index
        return [dict(faq_id=self.faqs[int(o)].faq_id, query=t)
                for t, o, s in zip(index.phrasings, index.owners, index.sources) if s == 'learned']

    # ----- learning from feedback ---------------------------------------------
    def learn(self, query: str, faq_id: str) -> bool:
        """Add a user's wording as a new phrasing of faq_id. Returns False if already known."""
        query, faq_id = query.strip(), faq_id.strip().upper()
        if faq_id not in self.faq_index:
            raise KeyError(faq_id)
        index = self._index
        if not query or any(query.casefold() == p.casefold() for p in index.phrasings):
            return False
        embedding = self._encode([query])
        self._index = self._build([*index.phrasings, query], [*index.owners, self.faq_index[faq_id]],
                                  [*index.sources, 'learned'], np.vstack([index.embeddings, embedding]))
        if self.learned_path:
            self.learned_path.parent.mkdir(parents=True, exist_ok=True)
            new_file = not self.learned_path.is_file()
            with self.learned_path.open('a', newline='') as stream:
                writer = csv.writer(stream)
                if new_file:
                    writer.writerow(['faq_id', 'query'])
                writer.writerow([faq_id, query])
        return True

    def reset_learned(self) -> int:
        index, removed = self._index, self.learned_count
        keep = [i for i, s in enumerate(index.sources) if s != 'learned']
        self._index = self._build([index.phrasings[i] for i in keep], index.owners[keep],
                                  [index.sources[i] for i in keep], index.embeddings[keep])
        if self.learned_path and self.learned_path.is_file():
            self.learned_path.unlink()
        return removed

    # ----- ranking ------------------------------------------------------------
    @staticmethod
    def _best_per_faq(values: np.ndarray, owners: np.ndarray, group_ends: np.ndarray):
        """Max value per FAQ and the phrasing index that produced it."""
        order = np.lexsort((values, owners))       # by FAQ, then ascending value
        best_phrase = order[group_ends - 1]        # last of each FAQ group is its maximum
        return values[best_phrase], best_phrase

    def keyword_scores(self, query: str, mode: str, index: _Index | None = None) -> np.ndarray:
        """Per-FAQ keyword score in [0, 1] for the given mode."""
        index = index or self._index
        if mode in ('bm25', 'keyword'):
            raw = np.maximum(index.bm25.get_scores(bm25_tokens(query)), 0)
            return raw / (raw + BM25_SATURATION)
        words = content_tokens(query)
        overlap_all = np.array([len(words & p) / len(words) if words else 0.0 for p in index.word_sets])
        return self._best_per_faq(overlap_all, index.owners, index.group_ends)[0]

    @staticmethod
    def weights(mode: str) -> tuple[float, float]:
        return {'semantic': (1.0, 0.0), 'keyword': (0.0, 1.0)}.get(mode, (SEMANTIC_WEIGHT, KEYWORD_WEIGHT))

    def encode_queries(self, queries: list[str]) -> np.ndarray:
        return self._encode(queries)

    def rank_many(self, queries: list[str], k: int = 3, mode: str | None = None,
                  category: str | None = None, embeddings: np.ndarray | None = None) -> list[list[Candidate]]:
        if not queries:
            return []
        mode = mode or DEFAULT_MODE
        if mode not in SCORING_MODES:
            raise ValueError(f'Unknown scoring mode: {mode}')
        if category is not None and category not in self.categories:
            raise ValueError(f'Unknown category: {category}')
        index = self._index  # consistent snapshot even if learn() runs concurrently
        embeddings = self._encode(queries) if embeddings is None else embeddings
        # Dot product of normalized embeddings equals cosine similarity.
        semantic_all = np.clip(embeddings @ index.embeddings.T, -1, 1)
        allowed = np.array([category is None or f.category == category for f in self.faqs])
        w_sem, w_kw = self.weights(mode)
        results = []
        for query, semantic_scores in zip(queries, semantic_all):
            words = content_tokens(query)
            semantic, best_semantic = self._best_per_faq(semantic_scores, index.owners, index.group_ends)
            overlap_all = np.array([len(words & p) / len(words) if words else 0.0 for p in index.word_sets])
            _, best_overlap = self._best_per_faq(overlap_all, index.owners, index.group_ends)
            keyword = self.keyword_scores(query, mode, index)
            scores = np.where(allowed, w_sem * semantic + w_kw * keyword, -np.inf)
            top = [i for i in np.argsort(-scores, kind='stable')[:k] if allowed[i]]
            results.append([
                Candidate(**self.faqs[int(i)].model_dump(), score=float(scores[i]),
                          semantic_similarity=float(semantic[i]), keyword_overlap=float(keyword[i]),
                          matched_phrasing=index.phrasings[best_semantic[i]],
                          phrasing_source=index.sources[best_semantic[i]],
                          matched_terms=sorted(words & index.word_sets[best_overlap[i]]))
                for i in top
            ])
        return results

    # ----- category prediction ------------------------------------------------
    def category_vectors(self) -> np.ndarray:
        """One normalized centroid per category (mean of its FAQ centroids)."""
        if self._category_vectors is None:
            centroids = self.faq_centroids()
            vectors = np.array([centroids[[f.category == c for f in self.faqs]].mean(axis=0) for c in self.categories])
            self._category_vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        return self._category_vectors

    def categories_from_ranking(self, query: str, embedding: np.ndarray, mode: str | None = None,
                                k: int = 3) -> list[tuple[str, float]]:
        """Predicted categories: those of the best unfiltered FAQ matches, each with its best score.
        The top-1 FAQ's category was the most accurate rule on the dev sets (97.6%), ahead of
        category centroids (79%) and score-weighted votes over the top 3-10 FAQs (81-91%)."""
        seen: dict[str, float] = {}
        for candidate in self.rank_many([query], k=10, mode=mode, embeddings=embedding)[0]:
            seen.setdefault(candidate.category, candidate.score)
        return list(seen.items())[:k]

    def predict_categories(self, embeddings: np.ndarray, k: int = 3) -> list[list[tuple[str, float]]]:
        """Centroid baseline, reported in the evaluation comparison only."""
        similarity = embeddings @ self.category_vectors().T
        return [[(self.categories[i], float(row[i])) for i in np.argsort(-row)[:k]] for row in similarity]

    def find_answer(self, user_question: str, threshold: float | None = None,
                    category: str | None = None, mode: str | None = None) -> MatchResponse:
        started = perf_counter()
        threshold = SIMILARITY_THRESHOLD if threshold is None else threshold
        if not 0 <= threshold <= 1:
            raise ValueError('Threshold must be between 0 and 1.')
        if category is not None and category not in self.categories:
            raise ValueError(f'Unknown category: {category}')
        query = user_question.strip()
        embedding = self._encode([query]) if query else None
        matches = self.rank_many([query], mode=mode, category=category, embeddings=embedding)[0] if query else []
        predicted = self.categories_from_ranking(query, embedding, mode) if query else []
        accepted = bool(matches and matches[0].score >= threshold)
        best = matches[0] if accepted else None
        margin = matches[0].score - matches[1].score if len(matches) > 1 else None
        ambiguous = bool(accepted and margin is not None and matches[1].score >= threshold
                         and margin < AMBIGUITY_MARGIN)
        confidence = ('high' if accepted and matches[0].score >= max(HIGH_CONFIDENCE, threshold) and not ambiguous
                      else 'medium' if accepted else 'low')
        return MatchResponse(
            status='Match found' if accepted else 'No suitable match' if query else 'Invalid query',
            faq_id=best.faq_id if best else None,
            matched_question=best.question if best else None,
            answer=best.answer if best else (
                "I couldn't find a suitable FAQ. Please rephrase your question or contact support."
                if query else 'Please enter a question.'
            ),
            category=best.category if best else None,
            similarity=matches[0].score if matches else 0.0,
            threshold=threshold, top_matches=matches,
            confidence=confidence, ambiguous=ambiguous, margin=margin,
            predicted_categories=[CategoryScore(name=n, score=v) for n, v in predicted],
            category_filter=category, scoring_mode=mode or DEFAULT_MODE,
            elapsed_ms=round((perf_counter() - started) * 1000, 2),
        )

    # ----- knowledge-base analysis -------------------------------------------
    def faq_centroids(self) -> np.ndarray:
        """One normalized vector per FAQ: the mean of its curated (non-learned) phrasings."""
        index = self._index
        curated = np.array([s != 'learned' for s in index.sources])
        sums = np.zeros((len(self.faqs), index.embeddings.shape[1]))
        np.add.at(sums, index.owners[curated], index.embeddings[curated])
        return sums / np.linalg.norm(sums, axis=1, keepdims=True)

    def semantic_map(self) -> dict:
        """2D PCA projection of FAQ centroids; the basis is reused to place queries."""
        if self._map is None:
            centroids = self.faq_centroids()
            mean = centroids.mean(axis=0)
            _, singular, vt = np.linalg.svd(centroids - mean, full_matrices=False)
            basis = vt[:2]
            coords = (centroids - mean) @ basis.T
            explained = float((singular[:2] ** 2).sum() / (singular ** 2).sum())
            self._map = dict(mean=mean, basis=basis, explained=explained, points=[
                dict(faq_id=f.faq_id, category=f.category, question=f.question,
                     x=float(x), y=float(y)) for f, (x, y) in zip(self.faqs, coords)])
        return self._map

    def project(self, query: str) -> tuple[float, float]:
        data = self.semantic_map()
        x, y = (self._encode([query])[0] - data['mean']) @ data['basis'].T
        return float(x), float(y)

    def confusable_pairs(self, limit: int = 10) -> list[dict]:
        """FAQ pairs whose meanings are closest; candidates for merging or clearer wording."""
        centroids = self.faq_centroids()
        similarity = centroids @ centroids.T
        rows, cols = np.triu_indices(len(self.faqs), k=1)
        values = similarity[rows, cols]
        pairs = []
        for i in np.argsort(-values)[:limit]:
            a, b = self.faqs[rows[i]], self.faqs[cols[i]]
            pairs.append(dict(similarity=float(values[i]), a_id=a.faq_id, a_question=a.question,
                              b_id=b.faq_id, b_question=b.question,
                              same_category=a.category == b.category))
        return pairs
