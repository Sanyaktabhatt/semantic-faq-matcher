"""CSV storage boundary. A future SQL repository can implement the same contract."""
from pathlib import Path
from typing import Protocol

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

ALTERNATES_FILENAME = 'faq_alternate_questions.csv'


class FAQ(BaseModel):
    model_config = ConfigDict(frozen=True)
    faq_id: str
    category: str
    question: str
    answer: str
    # Extra phrasings used only for matching; excluded from API payloads.
    alternate_questions: tuple[str, ...] = Field(default=(), exclude=True)


class FAQRepository(Protocol):
    def load(self) -> list[FAQ]: ...


class CSVFAQRepository:
    """Loads the FAQ CSV plus optional alternate phrasings (faq_id, alternate_question)."""

    def __init__(self, path: Path, alternates_path: Path | None = None):
        self.path = path
        self.alternates_path = alternates_path if alternates_path is not None else path.parent / ALTERNATES_FILENAME

    def load(self) -> list[FAQ]:
        frame = pd.read_csv(self.path, dtype=str, keep_default_na=False)
        frame.columns = frame.columns.str.strip().str.lower()
        fields = ['faq_id', 'category', 'question', 'answer']
        missing = set(fields) - set(frame.columns)
        if missing:
            raise ValueError(f"FAQ CSV is missing columns: {', '.join(sorted(missing))}")
        frame = frame[fields].apply(lambda col: col.str.strip())
        frame['faq_id'] = frame['faq_id'].str.upper()
        if frame.empty or (frame == '').any().any():
            raise ValueError('FAQ CSV must contain complete, nonempty records.')
        if frame['faq_id'].duplicated().any():
            raise ValueError('FAQ CSV contains duplicate FAQ IDs.')
        alternates = self._load_alternates(set(frame['faq_id']))
        return [FAQ(**row, alternate_questions=tuple(alternates.get(row['faq_id'], [])))
                for row in frame.to_dict(orient='records')]

    def _load_alternates(self, ids: set[str]) -> dict[str, list[str]]:
        if not self.alternates_path.is_file():
            return {}
        frame = pd.read_csv(self.alternates_path, dtype=str, keep_default_na=False)
        frame.columns = frame.columns.str.strip().str.lower()
        if not {'faq_id', 'alternate_question'}.issubset(frame.columns):
            raise ValueError(f'{self.alternates_path.name} requires columns: faq_id, alternate_question')
        frame = frame[['faq_id', 'alternate_question']].apply(lambda col: col.str.strip())
        frame['faq_id'] = frame['faq_id'].str.upper()
        if (frame == '').any().any():
            raise ValueError(f'{self.alternates_path.name} contains empty values.')
        unknown = sorted(set(frame['faq_id']) - ids)
        if unknown:
            raise ValueError(f'{self.alternates_path.name} references unknown FAQ IDs: {", ".join(unknown)}')
        grouped: dict[str, list[str]] = {}
        for faq_id, text in zip(frame['faq_id'], frame['alternate_question']):
            if text not in grouped.setdefault(faq_id, []):
                grouped[faq_id].append(text)
        return grouped
