import os
from collections import Counter
from contextlib import asynccontextmanager
from hashlib import sha256
from pathlib import Path
from threading import Thread

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .analytics import QueryLog
from .evaluation import Evaluator, compare_modes
from .matcher import (AMBIGUITY_MARGIN, BM25_SATURATION, DEFAULT_MODE, HIGH_CONFIDENCE, KEYWORD_WEIGHT, MODEL_NAME, SEMANTIC_WEIGHT,
                      SIMILARITY_THRESHOLD, FAQMatcher)
from .repository import CSVFAQRepository, FAQ
from .schemas import EvaluationRequest, FeedbackRequest, MatchRequest, MatchResponse, ProjectRequest

ROOT = Path(__file__).resolve().parent

# Selectable knowledge bases. FAQ_DATASET picks one; FAQ_DATA_PATH / FAQ_TEST_DATA_DIR still override.
DATASETS = {
    'bitext': dict(faqs=ROOT / 'datasets' / 'bitext' / 'semantic_faq_dataset.csv',
                   tests=ROOT / 'datasets' / 'bitext' / 'data',
                   label='Bitext Customer Support (Hugging Face)', license='CDLA-Sharing-1.0',
                   source='https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset'),
    'ecommerce': dict(faqs=ROOT / 'semantic_faq_dataset.csv', tests=ROOT / 'data',
                      label='E-commerce support FAQs (project dataset)', license=None, source=None),
}


def create_app(matcher: FAQMatcher | None = None, data_dir: Path | None = None) -> FastAPI:
    dataset_key = os.getenv('FAQ_DATASET', 'ecommerce')
    if dataset_key not in DATASETS:
        raise ValueError(f"FAQ_DATASET must be one of: {', '.join(DATASETS)}")
    dataset = DATASETS[dataset_key]
    faq_path = Path(os.getenv('FAQ_DATA_PATH', str(dataset['faqs'])))
    test_path = data_dir or Path(os.getenv('FAQ_TEST_DATA_DIR', str(dataset['tests'])))
    learned_path = Path(os.getenv('FAQ_LEARNED_PATH', str(ROOT / 'runtime' / f'learned_phrasings_{dataset_key}.csv')))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.matcher = matcher or FAQMatcher(CSVFAQRepository(faq_path), learned_path=learned_path)
        app.state.evaluator = Evaluator(app.state.matcher, test_path)
        app.state.log = QueryLog()
        app.state.dataset_sha256 = sha256(faq_path.read_bytes()).hexdigest()
        if os.getenv('FAQ_WARM_EVALUATION', '1') == '1' and matcher is None:
            Thread(target=app.state.evaluator.warm_up, daemon=True).start()
        yield

    app = FastAPI(title='Semantic FAQ Matcher', version='2.0.0', lifespan=lifespan)
    app.add_middleware(CORSMiddleware,
                       allow_origins=os.getenv('FAQ_CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(','),
                       allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

    @app.get('/api/health')
    def health(request: Request):
        return {'status': 'ready', 'model': MODEL_NAME, 'faq_count': len(request.app.state.matcher.faqs)}

    @app.get('/api/metadata')
    def metadata(request: Request):
        m = request.app.state.matcher
        return dict(model=MODEL_NAME, faq_count=len(m.faqs), phrasing_count=m.phrasing_count,
                    learned_count=m.learned_count,
                    categories=[{'name': name, 'count': count} for name, count in sorted(Counter(f.category for f in m.faqs).items())],
                    default_threshold=SIMILARITY_THRESHOLD, semantic_weight=SEMANTIC_WEIGHT, keyword_weight=KEYWORD_WEIGHT,
                    high_confidence=HIGH_CONFIDENCE, ambiguity_margin=AMBIGUITY_MARGIN,
                    scoring_mode=DEFAULT_MODE, bm25_saturation=BM25_SATURATION,
                    dataset_sha256=request.app.state.dataset_sha256,
                    dataset=dict(key=dataset_key, label=dataset['label'], license=dataset['license'],
                                 source=dataset['source'], file=faq_path.name),
                    datasets=request.app.state.evaluator.inventory())

    @app.get('/api/faqs', response_model=list[FAQ])
    def faqs(request: Request, search: str = Query('', max_length=200), category: str | None = None):
        return [f for f in request.app.state.matcher.faqs
                if (not category or f.category == category)
                and search.casefold() in f'{f.faq_id} {f.question} {f.answer}'.casefold()]

    @app.get('/api/dataset/download')
    def download():
        return FileResponse(faq_path, media_type='text/csv', filename='semantic_faq_dataset.csv')

    @app.post('/api/match', response_model=MatchResponse)
    def match(body: MatchRequest, request: Request):
        try:
            result = request.app.state.matcher.find_answer(body.query, body.threshold, category=body.category)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        request.app.state.log.record(body.query, result)
        return result

    @app.post('/api/feedback')
    def feedback(body: FeedbackRequest, request: Request):
        """Thumbs up/down on an answer. A helpful answer (or a user-chosen correction)
        teaches the matcher the user's wording as a new phrasing of that FAQ."""
        m = request.app.state.matcher
        faq_id = body.faq_id.strip().upper() if body.faq_id else None
        if faq_id and faq_id not in m.faq_index:
            raise HTTPException(status_code=422, detail=f'Unknown FAQ ID: {faq_id}')
        learned = bool(body.helpful and body.learn and faq_id and m.learn(body.query, faq_id))
        if learned:
            request.app.state.evaluator.invalidate()
        request.app.state.log.record_feedback(body.query, faq_id, body.helpful, learned)
        return dict(learned=learned, phrasing_count=m.phrasing_count, learned_count=m.learned_count)

    @app.get('/api/learned')
    def learned(request: Request):
        return request.app.state.matcher.learned_phrasings()

    @app.post('/api/learned/reset')
    def reset_learned(request: Request):
        removed = request.app.state.matcher.reset_learned()
        request.app.state.evaluator.invalidate()
        return dict(removed=removed)

    @app.get('/api/insights')
    def insights(request: Request):
        m = request.app.state.matcher
        return dict(**request.app.state.log.summary(), confusable_pairs=m.confusable_pairs(10),
                    learned_count=m.learned_count, learned=m.learned_phrasings()[-10:][::-1])

    @app.post('/api/insights/reset')
    def reset_insights(request: Request):
        request.app.state.log.clear()
        return dict(cleared=True)

    @app.get('/api/map')
    def semantic_map(request: Request):
        data = request.app.state.matcher.semantic_map()
        return dict(points=data['points'], explained_variance=data['explained'])

    @app.post('/api/map/project')
    def project(body: ProjectRequest, request: Request):
        m = request.app.state.matcher
        x, y = m.project(body.query)
        top = m.rank_many([body.query])[0]
        return dict(query=body.query, x=x, y=y, top=[dict(faq_id=c.faq_id, score=c.score) for c in top])

    @app.post('/api/evaluate/compare')
    def evaluate_compare(body: EvaluationRequest, request: Request):
        """Same test sets scored four ways: BM25 alone, semantic alone, and both hybrids."""
        try:
            return compare_modes(request.app.state.evaluator, body.threshold)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post('/api/evaluate')
    def evaluate(body: EvaluationRequest, request: Request):
        try:
            return request.app.state.evaluator.run(body.threshold)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return app


app = create_app()
