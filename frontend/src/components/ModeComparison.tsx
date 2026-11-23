import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../services/api';
import type { Comparison, Remote } from '../types';
import { ErrorNotice, Spinner } from './Shared';

type Set = Comparison['modes'][number]['sets'][number];

/** Pool several test sets into one rate, weighting each by its size. */
function pooled(sets: Set[], keys: string[], field: 'top1' | 'top3' | 'accepted' | 'rejection'): number | null {
  const chosen = sets.filter(s => keys.includes(s.key) && s[field] !== null);
  const n = chosen.reduce((sum, s) => sum + s.count, 0);
  return n ? chosen.reduce((sum, s) => sum + (s[field] ?? 0) * s.count, 0) / n : null;
}
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

const COLUMNS: { label: string; hint: string; keys: string[]; field: 'top1' | 'top3' | 'accepted' | 'rejection' }[] = [
  { label: 'Dev top-1', hint: 'Original + additional sets (126). Used to choose BM25 settings', keys: ['original', 'additional'], field: 'top1' },
  { label: 'Held-out top-1', hint: '484 questions never used for tuning', keys: ['holdout'], field: 'top1' },
  { label: 'Held-out top-3', hint: 'Expected FAQ is among the top 3', keys: ['holdout'], field: 'top3' },
  { label: 'Held-out correct', hint: 'Top FAQ is right and its score passes the threshold', keys: ['holdout'], field: 'accepted' },
  { label: 'Unrelated rejected', hint: 'All 60 out-of-scope questions', keys: ['unrelated', 'holdout_unrelated'], field: 'rejection' },
];

export function ModeComparison({ threshold }: { threshold: number }) {
  const [state, setState] = useState<Remote<Comparison>>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    controller.current?.abort();
    const c = new AbortController(); controller.current = c;
    setState({ kind: 'loading' });
    try { setState({ kind: 'success', data: await api.compare(threshold, c.signal) }); }
    catch (error) { if (!c.signal.aborted) setState({ kind: 'error', message: errorMessage(error) }); }
  }

  const data = state.kind === 'success' ? state.data : null;
  const values = data?.modes.map(m => COLUMNS.map(col => pooled(m.sets, col.keys, col.field))) ?? [];
  const best = COLUMNS.map((_, j) => Math.max(...values.map(row => row[j] ?? -1)));

  return <section className="panel compare-panel">
    <div className="compare-head">
      <div><h3>Scoring methods compared</h3><p>The same questions scored four ways at threshold {threshold.toFixed(2)}. The highest value in each column is bold.</p></div>
      <button className="secondary" onClick={() => void run()} disabled={state.kind === 'loading'}>{state.kind === 'loading' && <Spinner />}{data ? 'Run again' : 'Compare methods'}</button>
    </div>
    {state.kind === 'error' && <ErrorNotice message={state.message} retry={() => void run()} />}
    {data && <>
      <div className="table-scroll"><table className="compare-table">
        <thead><tr><th>Method</th>{COLUMNS.map(c => <th key={c.label} title={c.hint}>{c.label}</th>)}</tr></thead>
        <tbody>{data.modes.map((m, i) => <tr key={m.mode} className={m.default ? 'is-default' : ''}>
          <td>{m.label}{m.default && <span className="default-tag">in use</span>}</td>
          {values[i].map((v, j) => <td key={j} className={v !== null && v === best[j] ? 'best' : ''}>{pct(v)}</td>)}
        </tr>)}</tbody>
      </table></div>
      <p className="compare-note">Keyword-only scores are BM25 rankings without a meaningful threshold, so acceptance and rejection don't apply. Column definitions appear when you hover over a heading.</p>
      <h4>Category prediction</h4>
      <div className="table-scroll"><table className="compare-table">
        <thead><tr><th>Test set</th><th>Top FAQ’s category (in use)</th><th>Nearest category centroid</th></tr></thead>
        <tbody>{data.categories.map(c => <tr key={c.key}><td>{c.name} ({c.count})</td><td className="best">{pct(c.top_faq_accuracy)}</td><td>{pct(c.centroid_accuracy)}</td></tr>)}</tbody>
      </table></div>
      <p className="compare-note">Accuracy of predicting the expected FAQ’s category out of {data.category_count} categories.</p>
    </>}
  </section>;
}
