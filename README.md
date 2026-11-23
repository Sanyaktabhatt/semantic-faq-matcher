# Semantic FAQ Matcher · 

Clarity is a local full-stack FAQ search application built from `Semantic_FAQ_Matcher_Jury2.ipynb`. React provides semantic search, FAQ browsing, and an evaluation dashboard. FastAPI runs `all-MiniLM-L6-v2` through Sentence Transformers and PyTorch. Answers come directly from the existing CSV.

## What's new in v2

| Feature | Where | What it does |
| --- | --- | --- |
| Bigger knowledge base | `backend/` | 345 FAQs in 27 categories, with 1,380 phrasings (3 alternates per FAQ) |
| Multi-phrasing matching | `matcher.py` | Each FAQ is scored by its best-matching phrasing |
| BM25 hybrid scoring | `matcher.py` | The keyword term is BM25 (`rank_bm25`, one document per FAQ) instead of raw token overlap. `FAQ_SCORING_MODE=overlap` restores the old term |
| Category prediction and filter | Search | Shows the predicted category (the top FAQ's category, 93.3% accurate on held-out) and lets users restrict a search to one category |
| Scoring-method comparison | Evaluation → `POST /api/evaluate/compare` | Scores the same test sets with BM25 only, semantic only, semantic + overlap and semantic + BM25 |
| Confidence and "Did you mean?" | Search | High/medium/low confidence. If the top two answers are within 0.04, both are offered |
| Explainable matches | Search | Shows the matched phrasing, highlighted shared keywords, and a meaning-vs-keyword score bar |
| Learns from feedback | Search → `POST /api/feedback` | 👍 or "This is the right answer" adds the user's wording as a new phrasing instantly, with no retraining. Saved to `backend/runtime/learned_phrasings.csv` |
| Semantic map | Semantic map → `/api/map` | 2D PCA projection of all FAQ embeddings. Type a question to see where it lands and its nearest FAQs |
| Insights | Insights → `/api/insights` | Live question stats, knowledge gaps (unanswered questions), most-confusable FAQ pairs, learned phrasings |
| Held-out evaluation | Evaluation lab | 690 queries and 40 no-match queries, written independently from the FAQ list only |

## Datasets

Two knowledge bases are included; `FAQ_DATASET` selects one (default `ecommerce`):

| `FAQ_DATASET` | FAQs | Indexed phrasings | Labelled test questions | Source |
| --- | ---: | ---: | ---: | --- |
| `bitext` (optional) | 27 (one per intent, 11 categories) | 297 | 540 dev + 23,020 held-out | [Bitext Customer Support dataset](https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset), CDLA-Sharing-1.0 |
| `ecommerce` (default) | 345 (27 categories) | 1,380 | 126 + 690 held-out | Written for this project |

The Bitext files live in `backend/datasets/bitext/` and are rebuilt with
`python scripts/build_bitext_dataset.py <path to the Bitext CSV>`; see
[`backend/datasets/bitext/SOURCE.md`](backend/datasets/bitext/SOURCE.md) for how they were made.
Each dataset's test sets are listed in its `data/datasets.json`.

Bitext results (threshold 0.45, semantic + BM25):

| Test set | Top-1 | Top-3 | Correct after threshold | Rejected |
| --- | ---: | ---: | ---: | ---: |
| Bitext dev (540) | 91.7% | 98.1% | 91.1% | — |
| Bitext held-out (23,020) | 91.8% | 99.2% | 91.0% | — |
| Unrelated (20 / 40) | — | — | — | 100% / 97.5% |

Keyword search alone (BM25) reaches 88.3% on the Bitext held-out set: its utterances are
template paraphrases that share keywords, so the semantic advantage is smaller than on the
e-commerce held-out set (71.0% vs 86.5%). Category prediction is 99.4% accurate.

## Run locally

Use Python 3.12 and Node.js 22.12 or newer. Run these commands from this project directory, which is the application root.

Create a Python environment and install the backend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Windows, use `py -3.12 -m venv .venv` and `.venv\Scripts\Activate.ps1` in PowerShell instead of the first two commands.

The first backend start downloads the model from Hugging Face. Later starts reuse its cache. CPU inference is the default; no GPU, paid service, API key, or database is required. Startup finishes after the FAQ embeddings are ready. Allow time for the first download.

For a smaller CPU-only PyTorch installation on Linux or Windows, install it before the other backend requirements:

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

In a second terminal, start the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Keep both terminals running. Vite proxies `/api` to the backend on port 8000. Interactive API documentation is at **http://127.0.0.1:8000/docs**.

Ask “I forgot my password” to exercise the matcher. Open Knowledge base to browse, filter, expand, and download FAQs. Open Evaluation lab and select **Run evaluation** to measure the supplied test queries. Adjust the threshold and rerun to compare results. The dashboard starts without assumed metrics.

To check a production frontend bundle locally:

```bash
cd frontend
npm run build
npm run preview
```

Open the preview URL printed by Vite. Its `/api` proxy also requires the backend. For deployment elsewhere, serve `frontend/dist` and route `/api` to FastAPI through your hosting proxy. The included setup targets local use.

## Deploy the backend on Railway

1. Set the backend service's **Root Directory** to `/backend`.
2. Clear any custom **Build Command** and **Start Command**. Railway detects `backend/Dockerfile` and uses its startup command.
3. Set `FAQ_CORS_ORIGINS` to your frontend's HTTPS origin if the frontend calls Railway directly.
4. Redeploy, then request `/api/health` on the backend's public domain. Wait for `Application startup complete` before checking readiness. The first start downloads the model, so leave `FAQ_LOCAL_FILES_ONLY` unset until a model cache is available.

The Dockerfile installs Python 3.12 and CPU PyTorch, copies the backend package to `/app/backend`, and runs `backend.main:app` on `0.0.0.0` using Railway's `PORT` variable.

An error at `/app/main.py` with `attempted relative import with no known parent package` means the backend files were copied directly into `/app` and loaded as a top-level module. Use the Dockerfile layout and startup command together. Merely changing the command to `backend.main:app` will fail if the container has no `backend` directory.

Railway documents [Dockerfile detection](https://docs.railway.com/builds/dockerfiles) and [start command overrides](https://docs.railway.com/deployments/start-command).

## Project files

```text
Semantic_FAQ_matcher/
├── backend/
│   ├── main.py                    # FastAPI routes and model lifecycle
│   ├── matcher.py                 # FAQMatcher.find_answer and batch ranking
│   ├── evaluation.py              # Label-aware metrics and threshold sweep
│   ├── repository.py              # CSV validation and FAQRepository contract
│   ├── schemas.py                 # API request and response models
│   ├── requirements.txt
│   ├── semantic_faq_dataset.csv   # 345 FAQs in 27 categories (98 original + 247 added)
│   ├── faq_alternate_questions.csv # 1,035 alternate phrasings (3 per FAQ) used for matching
│   ├── analytics.py               # In-memory session analytics and knowledge gaps
│   └── data/                      # Supplied + held-out test CSVs and source hashes
├── frontend/
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       ├── pages/                 # Search, library, evaluation, model details
│       ├── services/              # API calls and runtime response validation
│       ├── types/
│       └── index.css
├── notebooks/Semantic_FAQ_Matcher_Jury2.ipynb
├── scripts/check_data.py
├── scripts/verify.py
└── tests/test_backend.py
```

## Verify the application

Activate the Python environment and run from the application root:

```bash
python -m unittest discover -s tests -v
python scripts/check_data.py
python scripts/verify.py
```

The unit tests cover the scoring formula, tokenization, threshold equality, rejection, invalid labels, CSV validation, and API request handling. They use fixed vectors to test scoring without downloading a model. `check_data.py` verifies the original source hashes and reports unknown labels.

See [the verification record](docs/validation.md) for the measured results and the current frontend verification limitation.

`verify.py` uses the running API and the real model. It checks all FAQ self-queries, recomputes each returned candidate score, evaluates every supplied test row, and independently checks metric denominators. It writes `artifacts/evaluation.json` and `artifacts/evaluation.csv`. Self-query checks verify integration; they do not measure generalization accuracy.

If TCP connections are unavailable in a restricted environment, run the same real-model API checks through FastAPI's ASGI transport:

```bash
FAQ_LOCAL_FILES_ONLY=1 python scripts/verify.py --in-process
```

`FAQ_LOCAL_FILES_ONLY=1` requires the model to be cached already. Omit that variable to allow the first download.

## API reference

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Model readiness and FAQ count after startup |
| POST | `/api/feedback` | `{query, faq_id, helpful}`. A helpful answer teaches the matcher this wording |
| GET | `/api/learned` · POST `/api/learned/reset` | List or remove learned phrasings |
| GET | `/api/insights` · POST `/api/insights/reset` | Session analytics, knowledge gaps, confusable FAQ pairs |
| GET | `/api/map` · POST `/api/map/project` | 2D semantic map; place a query on it |
| GET | `/api/metadata` | Model, weights, categories, threshold, source hash, test inventory |
| GET | `/api/faqs?search=order&category=Order%20Tracking` | Optional text and category filtering |
| GET | `/api/dataset/download` | Download the FAQ CSV |
| POST | `/api/match` | Return the best accepted FAQ and top three ranked candidates |
| POST | `/api/evaluate` | Evaluate all available supplied test sets |
| POST | `/api/evaluate/compare` | Same test sets under four scoring methods, plus category-prediction accuracy |

Example matching request:

```bash
curl http://127.0.0.1:8000/api/match \
  -H 'Content-Type: application/json' \
  -d '{"query":"I forgot my password","threshold":0.45}'
```

Evaluation accepts `{"threshold":0.45}`. Match queries must contain non-whitespace text and at most 2,000 characters. Thresholds must be finite numbers from 0 to 1. Invalid requests return HTTP 422. `/docs` contains the live endpoint schemas.

## BM25 vs token overlap

The keyword term was changed from raw token overlap to BM25, keeping the same 0.85 / 0.15 weights. The BM25 settings were chosen using **only** the supplied original and additional test sets (126 questions): one document per FAQ, and the saturation `bm25 / (bm25 + 10)`. Per-query max-scaling was rejected because it lowered unrelated-query rejection from 100% to 95%. The 484-question held-out set was used only once, for the final numbers (threshold 0.45). This comparison was made when the dataset had 242 FAQs; current numbers for 345 FAQs follow below.

| Method | Dev top-1 | Held-out top-1 | Held-out top-3 | Held-out correct after threshold | Unrelated rejected (60) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Keyword search only (BM25) | 70.6% | 72.3% | 82.9% | n/a | n/a |
| Semantic only | 88.1% | 86.8% | 96.7% | 85.3% | 86.7% |
| Semantic + token overlap | 89.7% | 88.0% | 97.3% | 85.1% | 88.3% |
| **Semantic + BM25 (default)** | **90.5%** | **88.0%** | **97.3%** | **85.7%** | **90.0%** |

BM25 does **not** improve ranking on held-out data: top-1 and top-3 are identical to token overlap. It is slightly better at the threshold, with 3 more correct answers and 1 more rejected unrelated question. These differences are small, so the main benefit of the keyword term is as a tiebreaker. Semantic matching is what drives accuracy: it is about 15 points ahead of keyword-only BM25.

**Category prediction** uses the top FAQ's category. On the dev sets it beat both per-category embedding centroids (79%) and score-weighted votes over the top 3–10 FAQs (81–91%). Held-out accuracy is 93.3% across 27 categories.

**Current results (345 FAQs, 690 held-out questions, threshold 0.45):**

| Method | Held-out top-1 | Held-out top-3 | Held-out correct after threshold | Unrelated rejected (60) |
| --- | ---: | ---: | ---: | ---: |
| Keyword search only (BM25) | 71.0% | 82.0% | n/a | n/a |
| Semantic only | 84.9% | 95.5% | 83.6% | 86.7% |
| Semantic + token overlap | 86.1% | 95.8% | 83.5% | 86.7% |
| **Semantic + BM25 (default)** | **86.5%** | **95.9%** | **84.5%** | **88.3%** |

Accuracy is slightly lower than with 242 FAQs (88.0% top-1) because there are 103 more FAQs to choose between; the semantic advantage over keyword search is unchanged at about 15 points.

## Matching method

The model and weights are the notebook's. Two changes improve matching. First, each FAQ is represented by its question **plus alternate phrasings**, and each FAQ keeps its best-scoring phrasing. Second, keyword overlap ignores stopwords:

```text
semantic_similarity = max over phrasings p of cosine(query_embedding, embedding(p))
keyword_score       = bm25 / (bm25 + 10)     # BM25 of the query against the FAQ's phrasings as one document
combined_score      = 0.85 * semantic_similarity + 0.15 * keyword_score
```

Tokens are distinct lowercase matches of `\b[a-z0-9]+\b`. Terms are tokens minus a small stopword list (`how`, `do`, `i`, `my`, ...). Without that list, phrasings like "how do I ..." inflate overlap between unrelated questions. If a query contains only stopwords, all its tokens are used. Each candidate reports `matched_phrasing`, the phrasing that produced its semantic score. The UI shows it under the candidate. FAQ and query embeddings are normalized. Their dot product computes cosine similarity. The [Sentence Transformers encoding API](https://sbert.net/docs/package_reference/sentence_transformer/SentenceTransformer.html) documents this normalization option.

`FAQMatcher.find_answer()` retains the notebook function name and result fields. It adds the threshold, elapsed time, candidate answers, and score components. A best score greater than or equal to the threshold returns the FAQ answer. A lower score returns the original rephrase-or-contact-support fallback while still exposing the candidates. The API rejects empty questions before inference.

The initial threshold is **0.45**. It is not a proven optimum. Scores are similarity measures, not confidence probabilities. Full precision controls ranking and acceptance; the UI rounds scores only for display.

FAQ embeddings load once through [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/). Blocking inference runs in FastAPI worker threads. A lock serializes access to the model. Test-query embeddings and scores are cached for the current process, so changing a threshold does not require another encoding pass. Each server worker loads its own model and data snapshot.

## Dataset and evaluation notes

| File | Records |
| --- | ---: |
| `backend/semantic_faq_dataset.csv` | 345 FAQs (98 original + 247 added) |
| `backend/faq_alternate_questions.csv` | 1,035 alternate phrasings |
| `backend/data/semantic_faq_test_queries.csv` (supplied) | 20 |
| `backend/data/semantic_faq_additional_test_queries.csv` (supplied) | 106 |
| `backend/data/semantic_faq_no_match_test_queries.csv` (supplied) | 20 |
| `backend/data/semantic_faq_holdout_test_queries.csv` (new) | 690 (2 per FAQ) |
| `backend/data/semantic_faq_holdout_no_match_queries.csv` (new) | 40 (25 off-topic, 15 near-domain) |

The 247 new FAQs add 17 categories: Order Changes, Gift Cards, Membership, Warranty and Repairs, Rewards, Mobile App, Device Setup and Troubleshooting, Installation and Assembly, Pre-orders, Subscribe and Save, Accessibility, International and Customs, Promotions and Sales, Pickup Points and Lockers, Digital Products, Product Safety and Recalls, and Gift Orders. Topics covered by the no-match test questions (gift wrapping, engraving, recyclable packaging, careers, selling on the marketplace and similar) were deliberately left out so those questions stay unanswerable. They also fill gaps in the existing ones, such as return shipping cost, invoices, instalments, international shipping, and 2FA. `ORD011` ("How do I cancel my order?") was added. The supplied test row "I want to stop my order" expected `ORD011`, which previously did not exist, so that label is now valid.

**Held-out set.** The held-out queries were written by a separate author who saw only the FAQ list. That author did not see the alternate phrasings or the supplied test sets. The held-out set therefore measures generalisation, not memorisation. Some held-out queries independently use the same everyday wording as an alternate phrasing. After removing the 58 queries with cosine ≥ 0.9 to any stored phrasing, Top-1 is still 85.3% (632 of 690 queries).

**Measured impact** (all-MiniLM-L6-v2, threshold 0.45):

| Test set | Before (98 FAQs, notebook scoring) | After (345 FAQs, v2 matching) |
| --- | --- | --- |
| Original, Top-1 / Top-3 | 73.7% / 89.5% (19 valid) | 90.0% / 95.0% (20 valid) |
| Additional, Top-1 / Top-3 | 81.1% / 96.2% | 87.7% / 96.2% |
| Held-out, Top-1 / Top-3 * | 71.3% / 88.9% (171 queries) | 85.3% / 95.6% (632 queries) |
| Supplied unrelated, rejected | 100% | 95% (19 of 20) |
| Held-out unrelated, rejected | 90.0% | 85.0% |

\* Held-out queries with cosine < 0.9 to every stored phrasing, so near-copies are excluded. The "before" column can only score labels that exist in the 98-FAQ set. The "after" column ranks against 345 FAQs, which is a harder task. The one supplied unrelated question now accepted is "What is the current exchange rate?", which matches the new FAQ on the currency charged for international orders.

**Trade-off.** More phrasings raise the best-match score for near-domain non-questions too, for example "is your packaging recyclable" or "do you offer gift wrapping". Rejection of tricky out-of-scope queries therefore drops slightly at 0.45. The threshold chart in the Evaluation lab shows this trade-off.

Metrics follow these definitions:

- **Top-1 accuracy:** the highest-ranked FAQ has the expected ID, before thresholding, divided by valid labeled queries.
- **Top-3 accuracy:** the expected ID appears among the three ranked candidates, divided by valid labeled queries.
- **Correct after threshold:** the returned FAQ has the expected ID, divided by all valid labeled queries. Rejections remain in this denominator.
- **Unrelated-query rejection rate:** rejected queries divided by queries in the supplied no-match CSV. False accepts count unrelated questions that received an FAQ.

The original and additional sets remain separate. The dashboard reports repeated query rows, invalid labels, per-query outcomes, measurement time, and file hashes. Missing test files produce unavailable metrics rather than invented results. Malformed files produce a validation error.

The threshold chart explores 0.20 through 0.80 on these same queries. Its correct-match series pools valid labeled rows from both labeled files; its rejection series uses only the no-match file. These sets can overlap and should not be presented as independent held-out validation. A threshold selected from this chart needs fresh validation data. Exact-ID scoring can also mark a related answer incorrect when the original label names another FAQ.

## Change the datasets

Add alternate phrasings to `backend/faq_alternate_questions.csv` (`faq_id,alternate_question`; every ID must exist). Replace `backend/semantic_faq_dataset.csv` with a UTF-8 CSV containing `faq_id`, `category`, `question`, and `answer`, then restart the backend. IDs must be unique and every required field must contain text. The loader trims fields and normalizes IDs to uppercase. It fails startup for missing columns, duplicate IDs, empty records, or an empty dataset.

Keep labeled test files in `backend/data` with `user_query,expected_faq_id`. The unrelated-query file needs `user_query`. Restart after changing either FAQ or test data to rebuild the embeddings and cached test scores. `provenance.json` records the original imported files; `check_data.py` intentionally reports hash changes after a deliberate dataset update. Live metadata and evaluation reports include current hashes.

To add PostgreSQL later, implement `FAQRepository.load()` and pass it to `FAQMatcher`. Ranking and evaluation depend on the repository contract rather than CSV parsing.

## Configuration and troubleshooting

| Variable | Default | Purpose |
| --- | --- | --- |
| `FAQ_DATA_PATH` | `backend/semantic_faq_dataset.csv`, resolved beside the backend code | Alternative FAQ file |
| `FAQ_TEST_DATA_DIR` | `backend/data`, resolved beside the backend code | Alternative test directory |
| `FAQ_DEVICE` | `cpu` | PyTorch inference device, such as `cuda` |
| `FAQ_LOCAL_FILES_ONLY` | `0` | Set to `1` to require the cached model |
| `FAQ_DATASET` | `ecommerce` | Knowledge base: `ecommerce` or `bitext` |
| `FAQ_WARM_EVALUATION` | `1` | Pre-compute test-set embeddings in the background at startup |
| `FAQ_SCORING_MODE` | `bm25` | Keyword term: `bm25`, `overlap`, `semantic` (no keyword term) or `keyword` (BM25 only) |
| `FAQ_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated origins for direct API clients |

The UI keeps the chosen threshold and recent questions in memory. Session analytics live in backend memory and reset on restart. The only user text written to disk is a question the user explicitly confirms with feedback. It goes to `backend/runtime/learned_phrasings.csv`, set by `FAQ_LEARNED_PATH`, and the Insights page can reset it. The evaluation export is a user-triggered JSON download. The CLI writes local JSON and CSV reports.

If the UI says the API is unavailable, wait for Uvicorn's `Application startup complete` message and check `/api/health`. If port 8000 changes, update both proxy targets in `frontend/vite.config.ts`. If npm cannot resolve packages or the model cannot download, check your network connection. An offline setup needs both the npm dependencies and Hugging Face model cached in advance.

The frontend uses React, Vite, strict TypeScript, Lucide React, Recharts, and [Tailwind's Vite integration](https://tailwindcss.com/docs/installation/using-vite). API response validation lives at the fetch boundary through Zod. Loading, empty, rejected, and error states use actual request outcomes.
# semantic-faq-matcher
