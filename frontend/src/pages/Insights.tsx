import { Activity, Brain, CircleAlert, Gauge, GitCompareArrows, RefreshCw, RotateCcw, ThumbsUp, Timer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorNotice, PageHeading, percent, Spinner, Tag } from '../components/Shared';
import { api, errorMessage } from '../services/api';
import type { Insights, Remote } from '../types';

export function InsightsPage({ onLearnedReset }: { onLearnedReset: () => void }) {
  const [state, setState] = useState<Remote<Insights>>({ kind: 'loading' });
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setState({ kind: 'success', data: await api.insights(signal) }); }
    catch (error) { if (!signal?.aborted) setState({ kind: 'error', message: errorMessage(error) }); }
  }, []);
  useEffect(() => {
    const c = new AbortController(); void load(c.signal);
    const timer = window.setInterval(() => void load(c.signal), 5000);  // live refresh during the demo
    return () => { c.abort(); window.clearInterval(timer); };
  }, [load]);

  async function resetLearned() {
    if (!window.confirm('Remove every phrasing learned from feedback? The curated dataset is not affected.')) return;
    await api.resetLearned(); onLearnedReset(); void load();
  }
  async function resetLog() { await api.resetInsights(); void load(); }

  const data = state.kind === 'success' ? state.data : null;
  return <>
    <PageHeading title="Insights" description="Usage in this session, unanswered questions, and FAQ pairs that are close in meaning."
      action={<div className="heading-actions"><button className="secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button><button className="secondary" onClick={() => void resetLog()}><RotateCcw size={15} /> Clear session log</button></div>} />
    {state.kind === 'error' && <ErrorNotice message={state.message} retry={() => void load()} />}
    {state.kind === 'loading' && <div className="empty-answer"><Spinner /><h3>Loading insights…</h3></div>}
    {data && <>
      <div className="insight-tiles">
        <Tile Icon={Activity} label="Questions this session" value={String(data.total_queries)} sub={`${data.matched} answered · ${data.unmatched} unanswered`} />
        <Tile Icon={Gauge} label="Answer rate" value={data.match_rate === null ? '—' : percent(data.match_rate)} sub={`${data.confidence.high ?? 0} high · ${data.confidence.medium ?? 0} medium confidence`} />
        <Tile Icon={Timer} label="Average response" value={data.avg_latency_ms === null ? '—' : `${data.avg_latency_ms.toFixed(0)} ms`} sub="Encode + rank on CPU" />
        <Tile Icon={Brain} label="Learned phrasings" value={String(data.learned_count)} sub={`${data.feedback.helpful} helpful · ${data.feedback.not_helpful} not helpful`} />
      </div>

      <div className="insight-grid">
        <section className="panel chart-card"><h3>Questions by category</h3><p>Answered questions this session</p>
          {data.categories.length ? <div className="chart" style={{ height: Math.max(160, data.categories.length * 34 + 30) }}><ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={data.categories} margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke="#eef0f3" />
              <XAxis type="number" allowDecimals={false} fontSize={11} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={150} fontSize={11} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#f5f6f8' }} formatter={(v: unknown) => [`${Number(v)} questions`, 'Answered']} />
              <Bar dataKey="count" fill="#245ea8" radius={[0, 4, 4, 0]} maxBarSize={22} />
            </BarChart></ResponsiveContainer></div> : <p className="muted-copy">Ask a few questions on the search page. They appear here live.</p>}
        </section>

        <section className="panel"><div className="panel-header"><h2><CircleAlert size={17} /> Knowledge gaps</h2><Tag tone="amber">{data.knowledge_gaps.length}</Tag></div>
          <p className="muted-copy">Questions that fell below the threshold. Each one is a candidate for a new FAQ.</p>
          {data.knowledge_gaps.length ? <ul className="gap-list">{data.knowledge_gaps.map(g => <li key={g.query + g.at}><strong>“{g.query}”</strong><span>Closest: {g.nearest_faq_id ? <><code>{g.nearest_faq_id}</code> {g.nearest_question}</> : '—'} <b className="mono">{g.score.toFixed(3)}</b></span></li>)}</ul> : <p className="empty-mini">No gaps yet. Every question was answered.</p>}
        </section>
      </div>

      <section className="panel"><div className="panel-header"><h2><GitCompareArrows size={17} /> Knowledge base health: most similar FAQ pairs</h2><Tag tone="gray">Computed from embeddings</Tag></div>
        <p className="muted-copy">These pairs sit closest together in meaning, so they are the ones the matcher is most likely to mix up. More distinct alternate phrasings, or merging the two, would help.</p>
        <div className="table-scroll"><table><thead><tr><th>Similarity</th><th>FAQ A</th><th>FAQ B</th></tr></thead><tbody>{data.confusable_pairs.map(p => <tr key={p.a_id + p.b_id}><td><SimilarityMeter value={p.similarity} /></td><td><code>{p.a_id}</code> {p.a_question}</td><td><code>{p.b_id}</code> {p.b_question}{!p.same_category && <Tag tone="amber">cross-category</Tag>}</td></tr>)}</tbody></table></div>
      </section>

      <div className="insight-grid">
        <section className="panel"><div className="panel-header"><h2><Activity size={17} /> Recent questions</h2></div>
          {data.recent.length ? <ul className="recent-list">{data.recent.map(r => <li key={r.query + r.at}><span className={`state-dot ${r.accepted ? 'ok' : 'miss'}`} aria-label={r.accepted ? 'Answered' : 'Unanswered'} /><span>{r.query}</span><code>{r.faq_id ?? 'No match'}</code><b className="mono">{r.score.toFixed(3)}</b></li>)}</ul> : <p className="empty-mini">Nothing yet.</p>}
          <p className="caption">Kept in memory only and cleared on restart. Questions are never written to disk.</p>
        </section>
        <section className="panel"><div className="panel-header"><h2><ThumbsUp size={17} /> Learned from feedback</h2>{data.learned_count > 0 && <button className="text-button" onClick={() => void resetLearned()}>Reset learning</button>}</div>
          <p className="muted-copy">When a user confirms or chooses an answer, their wording becomes a new phrasing for that FAQ immediately, with no retraining.</p>
          {data.learned.length ? <ul className="recent-list">{data.learned.map(l => <li key={l.faq_id + l.query}><Brain size={14} /><span>{l.query}</span><code>{l.faq_id}</code></li>)}</ul> : <p className="empty-mini">None yet. Marking an answer as helpful on the Search page adds one.</p>}
          <p className="caption">Learned phrasings are saved to backend/runtime/learned_phrasings.csv and reloaded on restart.</p>
        </section>
      </div>
    </>}
  </>;
}

function Tile({ Icon, label, value, sub }: { Icon: typeof Activity; label: string; value: string; sub: string }) {
  return <section className="panel insight-tile"><span className="stat-icon"><Icon size={19} /></span><div><span className="eyebrow">{label}</span><strong>{value}</strong><small>{sub}</small></div></section>;
}
function SimilarityMeter({ value }: { value: number }) {
  return <span className="sim-meter"><span style={{ width: `${Math.max(0, value) * 100}%` }} /><b className="mono">{value.toFixed(3)}</b></span>;
}
