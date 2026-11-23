import { Compass, Crosshair } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { ErrorNotice, PageHeading, Spinner, Tag } from '../components/Shared';
import { api, errorMessage } from '../services/api';
import type { Metadata, Projection, Remote, SemanticMap } from '../types';

// Scatter charts keep at most three hues so every pair stays distinguishable:
// neutral for context, blue for the selected category, orange for the query, aqua for its matches.
const COLORS = { context: '#cfd4dc', category: '#2a78d6', query: '#eb6834', match: '#1baf7a' };

type Point = { faq_id: string; category: string; question: string; x: number; y: number; kind: 'context' | 'category' | 'match' | 'query'; score?: number };

export function SemanticMapPage({ metadata }: { metadata: Metadata | null }) {
  const [map, setMap] = useState<Remote<SemanticMap>>({ kind: 'loading' });
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [projection, setProjection] = useState<Remote<Projection>>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api.map(c.signal).then(data => setMap({ kind: 'success', data })).catch(error => { if (!c.signal.aborted) setMap({ kind: 'error', message: errorMessage(error) }); });
    return () => { c.abort(); controller.current?.abort(); };
  }, []);

  async function locate(event?: FormEvent, text = query) {
    event?.preventDefault();
    if (!text.trim()) return;
    controller.current?.abort();
    const c = new AbortController(); controller.current = c;
    setQuery(text); setProjection({ kind: 'loading' });
    try { setProjection({ kind: 'success', data: await api.project(text.trim(), c.signal) }); }
    catch (error) { if (!c.signal.aborted) setProjection({ kind: 'error', message: errorMessage(error) }); }
  }

  const proj = projection.kind === 'success' ? projection.data : null;
  const layers = useMemo(() => {
    if (map.kind !== 'success') return null;
    const matchScores = new Map(proj?.top.map(t => [t.faq_id, t.score]) ?? []);
    const points: Point[] = map.data.points.map(p => ({
      ...p, kind: matchScores.has(p.faq_id) ? 'match' : category && p.category === category ? 'category' : 'context',
      score: matchScores.get(p.faq_id),
    }));
    return {
      context: points.filter(p => p.kind === 'context'),
      category: points.filter(p => p.kind === 'category'),
      match: points.filter(p => p.kind === 'match'),
      query: proj ? [{ faq_id: 'YOU', category: 'Your question', question: proj.query, x: proj.x, y: proj.y, kind: 'query' as const }] : [],
    };
  }, [map, proj, category]);

  const examples = ['my parcel never showed up', 'the app keeps crashing', 'can I pay in instalments', 'what is the capital of France'];
  return <>
    <PageHeading title="Semantic map" description="FAQ embeddings projected to two dimensions. Enter a question to see where it falls." />
    <section className="panel map-controls">
      <form onSubmit={event => void locate(event)}><Crosshair size={17} /><input aria-label="Question to place on the map" placeholder="Enter a question" value={query} onChange={event => setQuery(event.target.value)} maxLength={2000} /><button className="primary" disabled={!query.trim() || projection.kind === 'loading'}>{projection.kind === 'loading' && <Spinner />}Plot</button></form>
      <div className="map-examples">{examples.map(e => <button key={e} onClick={() => void locate(undefined, e)}>{e}</button>)}</div>
      <label className="map-filter">Highlight category <select value={category} onChange={event => setCategory(event.target.value)}><option value="">None</option>{metadata?.categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}</select></label>
    </section>
    {map.kind === 'error' && <ErrorNotice message={map.message} />}
    {projection.kind === 'error' && <ErrorNotice message={projection.message} />}
    {map.kind === 'loading' && <div className="empty-answer"><Spinner /><h3>Projecting the knowledge base…</h3></div>}
    {layers && map.kind === 'success' && <div className="map-layout">
      <section className="panel chart-card map-card">
        <div className="map-legend">
          <span><i style={{ background: COLORS.context }} />FAQ</span>
          {category && <span><i style={{ background: COLORS.category }} />{category}</span>}
          {proj && <><span><i className="ring" style={{ background: COLORS.query }} />Your question</span><span><i style={{ background: COLORS.match }} />Top matches</span></>}
        </div>
        <div className="map-chart"><ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 12, bottom: 4, left: -18 }}>
            <CartesianGrid stroke="#eef0f3" />
            <XAxis type="number" dataKey="x" tick={false} axisLine={false} tickLine={false} domain={['dataMin - 0.05', 'dataMax + 0.05']} />
            <YAxis type="number" dataKey="y" tick={false} axisLine={false} tickLine={false} domain={['dataMin - 0.05', 'dataMax + 0.05']} />
            <ZAxis range={[70, 70]} />
            <Tooltip cursor={false} content={<MapTooltip />} />
            <Scatter data={layers.context} fill={COLORS.context} isAnimationActive={false} />
            <Scatter data={layers.category} fill={COLORS.category} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
            <Scatter data={layers.match} fill={COLORS.match} stroke="#fff" strokeWidth={2} isAnimationActive={false} shape={<Dot r={8} />} />
            <Scatter data={layers.query} fill={COLORS.query} isAnimationActive={false} shape={<QueryDot />} />
          </ScatterChart>
        </ResponsiveContainer></div>
        <p className="caption">2D principal-component projection of {map.data.points.length} FAQ embeddings (384 dimensions → 2). It keeps {(map.data.explained_variance * 100).toFixed(0)}% of the variance, so nearby points are similar but distances are approximate. Matching always uses the full 384-dimensional vectors.</p>
      </section>
      <aside className="map-side">
        <section className="panel"><div className="panel-header"><h2><Compass size={17} /> Nearest FAQs</h2><Tag tone="gray">Full-dimension score</Tag></div>
          {!proj && <p className="muted-copy">Place a question to see where it lands and which FAQs sit closest to it.</p>}
          {proj && <ol className="nearest-list">{proj.top.map(t => { const p = map.data.points.find(p => p.faq_id === t.faq_id); return <li key={t.faq_id}><code>{t.faq_id}</code><div><strong>{p?.question}</strong><span>{p?.category}</span></div><b className="mono">{t.score.toFixed(3)}</b></li>; })}</ol>}
          {proj && proj.top[0] && proj.top[0].score < (metadata?.default_threshold ?? 0.45) && <p className="map-warning">The best score is below the {metadata?.default_threshold.toFixed(2)} threshold, so this question would be rejected as out of scope.</p>}
        </section>
        <section className="panel"><h3 className="side-title">Reading the map</h3><p className="muted-copy">Hover any dot to see its FAQ. Highlight a category to see its cluster. Off-topic questions like “capital of France” land far from every cluster, which is why the matcher rejects them.</p></section>
      </aside>
    </div>}
  </>;
}

function Dot({ cx = 0, cy = 0, r = 6, fill, stroke }: { cx?: number; cy?: number; r?: number; fill?: string; stroke?: string }) {
  return <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={2} />;
}
function QueryDot({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) {
  return <g><circle cx={cx} cy={cy} r={16} fill={COLORS.query} opacity={0.18} /><circle cx={cx} cy={cy} r={8} fill={COLORS.query} stroke="#fff" strokeWidth={2} /></g>;
}
function MapTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return <div className="map-tooltip"><span>{p.kind === 'query' ? 'Your question' : `${p.faq_id} · ${p.category}`}</span><strong>{p.question}</strong>{p.score !== undefined && <small>Score {p.score.toFixed(3)}</small>}</div>;
}
