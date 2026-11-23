"""In-memory query analytics. Nothing is written to disk; data resets on restart."""
from collections import Counter, deque
from datetime import datetime, timezone
from threading import Lock

from .schemas import MatchResponse


class QueryLog:
    def __init__(self, maxlen: int = 2000):
        self._events: deque[dict] = deque(maxlen=maxlen)
        self._feedback: deque[dict] = deque(maxlen=maxlen)
        self._lock = Lock()

    def record(self, query: str, result: MatchResponse) -> None:
        top = result.top_matches[0] if result.top_matches else None
        with self._lock:
            self._events.append(dict(
                at=datetime.now(timezone.utc).isoformat(), query=query, accepted=result.faq_id is not None,
                faq_id=result.faq_id, category=result.category, score=result.similarity,
                confidence=result.confidence, ambiguous=result.ambiguous, elapsed_ms=result.elapsed_ms,
                nearest_faq_id=top.faq_id if top else None, nearest_question=top.question if top else None))

    def record_feedback(self, query: str, faq_id: str | None, helpful: bool, learned: bool) -> None:
        with self._lock:
            self._feedback.append(dict(at=datetime.now(timezone.utc).isoformat(), query=query,
                                       faq_id=faq_id, helpful=helpful, learned=learned))

    def clear(self) -> None:
        with self._lock:
            self._events.clear(); self._feedback.clear()

    def summary(self) -> dict:
        with self._lock:
            events, feedback = list(self._events), list(self._feedback)
        accepted = [e for e in events if e['accepted']]
        faq_counts = Counter((e['faq_id'], e['category']) for e in accepted)
        gaps = [e for e in events if not e['accepted']]
        seen, unique_gaps = set(), []
        for e in reversed(gaps):  # newest first, deduplicated
            key = e['query'].casefold()
            if key not in seen:
                seen.add(key); unique_gaps.append({k: e[k] for k in ('query', 'score', 'nearest_faq_id', 'nearest_question', 'at')})
        return dict(
            total_queries=len(events), matched=len(accepted), unmatched=len(gaps),
            match_rate=len(accepted) / len(events) if events else None,
            avg_latency_ms=sum(e['elapsed_ms'] for e in events) / len(events) if events else None,
            avg_score=sum(e['score'] for e in events) / len(events) if events else None,
            confidence=dict(Counter(e['confidence'] for e in events)),
            ambiguous=sum(e['ambiguous'] for e in events),
            categories=[dict(name=n, count=c) for n, c in Counter(e['category'] for e in accepted).most_common()],
            top_faqs=[dict(faq_id=f, category=c, count=n) for (f, c), n in faq_counts.most_common(8)],
            knowledge_gaps=unique_gaps[:15],
            recent=[{k: e[k] for k in ('query', 'accepted', 'faq_id', 'score', 'confidence', 'at')} for e in reversed(events[-10:])],
            feedback=dict(helpful=sum(f['helpful'] for f in feedback),
                          not_helpful=sum(not f['helpful'] for f in feedback),
                          learned=sum(f['learned'] for f in feedback)),
        )
