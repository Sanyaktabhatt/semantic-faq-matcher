import { ArrowRight, Brain, Check, CheckCheck, ChevronDown, Clock3, Copy, CornerDownLeft, GitFork, SlidersHorizontal, ThumbsDown, ThumbsUp, X, Search as SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../services/api';
import type { FAQ, Match, Metadata, Remote } from '../types';

type Feedback = { kind: 'none' } | { kind: 'sending' } | { kind: 'done'; helpful: boolean; learned: boolean; faqId: string | null } | { kind: 'error'; message: string };
import { ErrorNotice, Spinner } from '../components/Shared';

export function SearchPage({ metadata, faqs, threshold, setThreshold }: {
  metadata: Metadata | null; faqs: FAQ[]; threshold: number; setThreshold: (value: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Remote<Match>>({ kind: 'idle' });
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [category, setCategory] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });
  const [chosen, setChosen] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event?: FormEvent, example?: string, categoryOverride?: string) {
    event?.preventDefault();
    const text = (example ?? query).trim();
    if (!text) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setQuery(text); setSubmittedQuery(text); setCopied(false); setFeedback({ kind: 'none' }); setChosen(null); setResult({ kind: 'loading' });
    try {
      const data = await api.match(text, threshold, current.signal, categoryOverride ?? category);
      setResult({ kind: 'success', data });
      setHistory(previous => [text, ...previous.filter(q => q !== text)].slice(0, 5));
    } catch (error) {
      if (!current.signal.aborted) setResult({ kind: 'error', message: errorMessage(error) });
    }
  }
  async function sendFeedback(helpful: boolean, faqId: string | null) {
    setFeedback({ kind: 'sending' });
    try {
      const data = await api.feedback(submittedQuery, faqId, helpful);
      setFeedback({ kind: 'done', helpful, learned: data.learned, faqId });
    } catch (error) { setFeedback({ kind: 'error', message: errorMessage(error) }); }
  }
  function choose(faqId: string) { setChosen(faqId); void sendFeedback(true, faqId); }
  const compact = result.kind !== 'idle';
  function reset() { controller.current?.abort(); setQuery(''); setResult({ kind: 'idle' }); setChosen(null); setFeedback({ kind: 'none' }); }
  const examples = ['my parcel never showed up', 'can I pay in instalments', 'the app keeps crashing', 'what is the capital of France'];
  void faqs;
  return <>
    {!compact && <div className="page-heading"><div><h1>Search</h1><p>Ask a customer-support question in your own words. It is matched by meaning against {metadata?.faq_count ?? '—'} FAQs in {metadata?.categories.length ?? '—'} categories.</p></div></div>}
    <div className="search-layout"><div className="search-main">
      <section className={`panel query-panel ${compact ? 'compact' : ''}`}>
        <form onSubmit={event => void submit(event)}><label htmlFor="question">{compact ? <>Your question{result.kind !== 'loading' && <button type="button" className="text-button new-question" onClick={reset}>Start over</button>}</> : 'What would you like to know?'}</label>
          <div className="textarea-wrap"><textarea id="question" placeholder="e.g. where is my order?" value={query} maxLength={2000} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(event); }} />
            {query && <button type="button" className="clear-query" onClick={() => setQuery('')} aria-label="Clear question"><X size={16} /></button>}
            <span className="character-count">{query.length}/2000</span></div>
          <div className="query-actions"><span><CornerDownLeft size={13} /> Ctrl + Enter to search</span><div className="query-buttons"><select className="category-select" aria-label="Limit search to a category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{metadata?.categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select><button className="primary" disabled={!query.trim() || result.kind === 'loading'}>{result.kind === 'loading' && <Spinner />}{result.kind === 'loading' ? 'Searching…' : 'Search'}</button></div></div>
        </form>
        {!compact && <div className="try-examples"><span>Try:</span><div>{examples.map(text => <button key={text} onClick={() => void submit(undefined, text)}>{text}</button>)}</div></div>}
      </section>
      <div aria-live="polite" aria-busy={result.kind === 'loading'}>
        
        {result.kind === 'loading' && <div className="panel answer-card tone-wait"><div className="answer-head"><span className="answer-icon"><Spinner /></span><div><strong>Searching…</strong><span>Comparing your question with every FAQ</span></div></div></div>}
        {result.kind === 'error' && <ErrorNotice message={result.message} retry={() => void submit()} />}
        {result.kind === 'success' && (() => {
          const data = result.data;
          const picked = chosen ? data.top_matches.find(m => m.faq_id === chosen) : undefined;
          const shown = picked ?? (data.faq_id ? data.top_matches[0] : undefined);
          const confidence = data.confidence ?? (data.faq_id ? 'medium' : 'low');
          // Far below the threshold means the question is off-topic: suggesting FAQs would only confuse.
          const unfilteredBest = data.predicted_categories?.[0]?.score ?? data.similarity;
          const offTopic = !shown && unfilteredBest < data.threshold * 0.75;
          // Filtered search failed, but the question clearly belongs to another category.
          const wrongFilter = !shown && !offTopic && !!data.category_filter && unfilteredBest >= data.threshold
            && data.predicted_categories?.[0]?.name !== data.category_filter ? data.predicted_categories?.[0]?.name : undefined;
          const tone = picked ? 'high' : !shown ? 'low' : confidence === 'high' ? 'high' : 'medium';
          const score = (picked?.score ?? data.similarity).toFixed(2);
          const head = picked ? ['Selected answer', `You chose this FAQ (score ${score}). Your wording has been saved for future matches.`]
            : offTopic ? ['Out of scope', `No FAQ is close to this question (best score ${score}, threshold ${data.threshold.toFixed(2)}).`]
            : !shown ? ['No confident match', `The best score is ${score}, below the ${data.threshold.toFixed(2)} threshold.`]
            : data.ambiguous ? ['Answer', `Score ${score}. A second FAQ scored almost the same, shown below.`]
            : confidence === 'high' ? ['Answer', `Strong match · score ${score}`]
            : ['Answer', `Moderate match · score ${score}. Check it fits your question.`];
          const others = data.top_matches.filter(m => m.faq_id !== shown?.faq_id);
          return <div className="result-stack">
            <section className={`panel answer-card tone-${tone}`}>
              <div className="answer-head">
                <span className="answer-icon">{tone === 'low' ? <SearchIcon size={18} /> : <Check size={18} />}</span>
                <div><strong>{head[0]}</strong><span>{head[1]}</span></div>
                <span className="answer-time"><Clock3 size={12} />{data.elapsed_ms.toFixed(0)} ms</span>
              </div>
              {!offTopic && (data.predicted_categories?.length || data.category_filter) && <div className="category-line">
                {data.predicted_categories?.[0] && <span>Predicted category <b>{data.predicted_categories[0].name}</b>{data.predicted_categories.length > 1 && <small> · then {data.predicted_categories.slice(1).map(c => c.name).join(', ')}</small>}</span>}
                {data.category_filter && <span className="filter-chip">Searching in <b>{data.category_filter}</b>{!wrongFilter && <button type="button" onClick={() => { setCategory(''); void submit(undefined, submittedQuery, ''); }}>Search all</button>}</span>}
              </div>}
              {shown ? <>
                <p className="answer-body">{shown.answer}</p>
                <p className="answer-source">Source: <b>{shown.faq_id}</b> “{shown.question}”<span className="dot-sep">·</span>{shown.category}</p>
              </> : wrongFilter ? <p className="answer-body muted">This looks like a <b>{wrongFilter}</b> question, not <b>{data.category_filter}</b>. <button type="button" className="text-button" onClick={() => { setCategory(''); void submit(undefined, submittedQuery, ''); }}>Search all categories</button></p> : <p className="answer-body muted">{offTopic ? 'This matcher answers store customer-support questions: orders, delivery, returns, refunds, payments, accounts and products.' : data.answer}</p>}
              {shown && <div className="answer-bar">
                <FeedbackButtons feedback={feedback} onVote={helpful => void sendFeedback(helpful, shown.faq_id)} />
                <button className="icon-text" onClick={() => { void navigator.clipboard.writeText(shown.answer).then(() => setCopied(true)).catch(() => setCopied(false)); }} aria-label="Copy answer">{copied ? <CheckCheck size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}</button>
              </div>}
              {feedback.kind === 'done' && <div className={`learn-note ${feedback.learned ? 'learned' : ''}`}>{feedback.learned ? <><Brain size={14} />Saved “{submittedQuery}” as a new phrasing of {feedback.faqId}.</> : feedback.helpful ? <><Check size={14} />Feedback recorded.</> : <><GitFork size={14} />Feedback recorded. Choose a better answer below if there is one.</>}</div>}
              {feedback.kind === 'error' && <div className="learn-note">{feedback.message}</div>}
            </section>
            {(!picked && !offTopic && !wrongFilter && (data.ambiguous || !shown || (feedback.kind === 'done' && !feedback.helpful))) && others.length > 0 && <section className="panel suggestions">
              <strong>{!shown ? 'Did you mean…' : 'Also close'}</strong>
              {(data.ambiguous && shown && !(feedback.kind === 'done' && !feedback.helpful) ? others.slice(0, 1) : others).map(m => <button key={m.faq_id} onClick={() => choose(m.faq_id)}><span>{m.question}</span><small>{m.category}</small><ArrowRight size={14} /></button>)}
            </section>}
            <details className="panel why-panel">
              <summary>Match details <span>Scores and top candidates</span><ChevronDown size={15} /></summary>
              <div className="why-body">
                <p className="why-explain">Your question was compared by meaning with {metadata?.phrasing_count ?? 'all'} FAQ phrasings. {shown?.matched_phrasing ? <>The closest was {shown.phrasing_source === 'learned' ? <b className="learned-badge">a learned phrasing</b> : shown.phrasing_source === 'alternate' ? 'an alternate phrasing' : 'the FAQ question'} “<Highlight text={shown.matched_phrasing} terms={shown.matched_terms ?? []} />”{(shown.matched_terms?.length ?? 0) > 0 && <> (shared words are highlighted)</>}. </> : null}Its match score is <b>{(shown?.score ?? data.similarity).toFixed(2)}</b>. Answers need at least <b>{data.threshold.toFixed(2)}</b>.</p>
                <div className="why-list">{data.top_matches.map((m, i) => <div key={m.faq_id} className={m.faq_id === shown?.faq_id ? 'current' : ''}>
                  <span className="rank">{i + 1}</span>
                  <div><strong>{m.question}</strong><small>{m.category} · {m.faq_id}</small><ScoreBar semantic={m.semantic_similarity} keyword={m.keyword_overlap} /></div>
                  <b className="mono">{m.score.toFixed(3)}</b>
                  {m.faq_id !== shown?.faq_id ? <button className="text-button" onClick={() => choose(m.faq_id)}>Use this</button> : <span className="tag green">Shown</span>}
                </div>)}</div>
                <p className="caption">Score = 85% meaning similarity + 15% shared keywords. Scores measure similarity. They are not the probability that an answer is correct.</p>
              </div>
            </details>
          </div>;
        })()}
      </div>
    </div>
    <aside className="search-aside">
      <section className="panel tuning-card"><button className="settings-toggle" onClick={() => setSettings(!settings)} aria-expanded={settings}><span><SlidersHorizontal size={16} /> Search settings</span><ChevronDown size={16} /></button>{settings && <div className="settings-content"><label htmlFor="search-threshold">Match threshold <b>{threshold.toFixed(2)}</b></label><input id="search-threshold" type="range" min="0" max="1" step="0.01" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /><p>Answers scoring below this are rejected. Default 0.45.</p><button className="text-button" onClick={() => setThreshold(0.45)}>Reset to 0.45</button></div>}</section>
      {history.length > 0 && <section className="recent"><div className="section-title"><h3>Recent questions</h3><button className="text-button" onClick={() => setHistory([])}>Clear</button></div>{history.map(text => <button key={text} onClick={() => void submit(undefined, text)}><Clock3 size={14} /><span>{text}</span><ArrowRight size={13} /></button>)}</section>}
    </aside></div>
  </>;
}
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const set = new Set(terms);
  return <>{text.split(/(\b[A-Za-z0-9]+\b)/).map((part, i) => set.has(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>)}</>;
}
function ScoreBar({ semantic, keyword }: { semantic: number; keyword: number }) {
  const s = Math.max(0, 0.85 * semantic) * 100, k = 0.15 * keyword * 100;
  return <div className="score-bar" aria-label={`Semantic contribution ${s.toFixed(1)}, keyword contribution ${k.toFixed(1)}`}><span className="sem" style={{ width: `${s}%` }} /><span className="kw" style={{ width: `${k}%` }} /><small>{s.toFixed(1)} meaning + {k.toFixed(1)} keywords</small></div>;
}
function FeedbackButtons({ feedback, onVote }: { feedback: Feedback; onVote: (helpful: boolean) => void }) {
  const done = feedback.kind === 'done' || feedback.kind === 'sending';
  const vote = feedback.kind === 'done' ? feedback.helpful : null;
  return <span className="feedback-buttons"><span>Helpful?</span><button disabled={done} className={vote === true ? 'on' : ''} onClick={() => onVote(true)} aria-label="Helpful"><ThumbsUp size={14} /></button><button disabled={done} className={vote === false ? 'on' : ''} onClick={() => onVote(false)} aria-label="Not helpful"><ThumbsDown size={14} /></button></span>;
}
