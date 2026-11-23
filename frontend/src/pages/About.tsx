import { PageHeading } from '../components/Shared';
import type { Metadata } from '../types';

const steps = [
  ['Embed the FAQs', 'At startup every FAQ question and its alternate phrasings are encoded into 384-dimensional vectors with all-MiniLM-L6-v2. The vectors are normalised and kept in memory.'],
  ['Embed the query', 'The user question is encoded with the same model. Cosine similarity with every phrasing is a single matrix product.'],
  ['Score and rank', 'Each FAQ takes the cosine of its best-matching phrasing. A BM25 keyword score is added with weight 0.15. For BM25 each FAQ is one document made of all its phrasings. FAQs are ranked by the combined score.'],
  ['Return or reject', 'If the top score is at or above the threshold, that FAQ’s answer is returned verbatim. Otherwise the question is rejected and the closest FAQs are listed.'],
  ['Predict the category', 'The predicted category is the category of the best-matching FAQs. Users can also restrict a search to one category.'],
  ['Learn from feedback', 'When a user confirms an answer, their wording is embedded and added as a new phrasing of that FAQ. No model retraining is involved.'],
];

export function AboutPage({ metadata }: { metadata: Metadata | null }) {
  const rows: [string, string][] = [
    ['Model', `${metadata?.model ?? 'all-MiniLM-L6-v2'} (sentence-transformers, runs locally on CPU)`],
    ['Embedding size', '384 dimensions, L2-normalised'],
    ['FAQs / categories', `${metadata?.faq_count ?? '—'} / ${metadata?.categories.length ?? '—'}`],
    ['Phrasings indexed', `${metadata?.phrasing_count ?? '—'}${metadata?.learned_count ? ` (${metadata.learned_count} learned from feedback)` : ''}`],
    ['Score', `${metadata?.semantic_weight ?? 0.85} × cosine similarity + ${metadata?.keyword_weight ?? 0.15} × BM25 keyword score`],
    ['Keyword method', `${metadata?.scoring_mode === 'overlap' ? 'Token overlap' : 'BM25 (rank_bm25, Okapi)'}, saturation constant ${metadata?.bm25_saturation ?? 10}`],
    ['Acceptance threshold', `${metadata?.default_threshold ?? 0.45} (adjustable; chosen on test data, not a proven optimum)`],
    ['High confidence', `score ≥ ${metadata?.high_confidence ?? 0.7}`],
    ['Ambiguous', `top two scores within ${metadata?.ambiguity_margin ?? 0.04}`],
  ];
  return <>
    <PageHeading title="Method" description="How a question is matched to an FAQ, and the parameters used." />
    <section className="panel method-section">
      <h2>Pipeline</h2>
      <ol className="method-steps">{steps.map(([title, text]) => <li key={title}><strong>{title}</strong><p>{text}</p></li>)}</ol>
    </section>
    <section className="panel method-section">
      <h2>Scoring</h2>
      <pre className="method-formula">{`semantic(q, f) = max over phrasings p of f:  cos(embed(q), embed(p))
bm25(q, f)     = BM25 of q against document f (all phrasings of f, stopwords removed)
keyword(q, f)  = bm25 / (bm25 + 10)            maps to [0, 1) without per-query rescaling
score(q, f)    = 0.85 · semantic + 0.15 · keyword
answer         = argmax_f score   if score ≥ threshold, else no match`}</pre>
      <p className="method-note">Scores are similarities, not probabilities. Held-out top-1 accuracy (690 questions) is 71.0% for keyword search alone (BM25), 84.9% for semantic matching alone, and 86.5% combined. BM25 and the earlier token-overlap term tie on ranking, but BM25 accepts slightly more correct answers and rejects slightly more unrelated questions. The Evaluation page compares all four methods.</p>
    </section>
    <section className="panel method-section">
      <h2>Parameters</h2>
      <table className="method-table"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
      <p className="method-note">Dataset SHA-256: <code>{metadata?.dataset_sha256 ?? '—'}</code></p>
    </section>
    <p className="method-links"><a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">API documentation</a> · <a href="https://sbert.net/docs/package_reference/sentence_transformer/SentenceTransformer.html" target="_blank" rel="noreferrer">Sentence Transformers documentation</a></p>
  </>;
}
