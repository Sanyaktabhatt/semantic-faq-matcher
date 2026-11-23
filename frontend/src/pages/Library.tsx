import { ChevronDown, Download, FileSpreadsheet, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { FAQ, Metadata } from '../types';
import { PageHeading, Tag } from '../components/Shared';

export function LibraryPage({ faqs, metadata }: { faqs: FAQ[]; metadata: Metadata | null }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  // Size the ID column to the longest ID (Bitext IDs such as CHANGE_SHIPPING_ADDRESS are long).
  const idWidth = `${Math.ceil(Math.max(6, ...faqs.map(f => f.faq_id.length)) * 0.85) + 1}ch`;
  const filtered = faqs.filter(faq => (!category || faq.category === category) && `${faq.question} ${faq.answer} ${faq.faq_id}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeading title="FAQ dataset" description="The question–answer pairs the matcher searches. Answers are always returned verbatim from this file." action={<a className="secondary" href="/api/dataset/download" download><Download size={16} /> Export CSV</a>} />
    <div className="dataset-banner"><span className="file-icon"><FileSpreadsheet size={24} /></span><div><strong>{metadata?.dataset?.label ?? 'semantic_faq_dataset.csv'}</strong><p>{metadata?.faq_count ?? '—'} FAQs · {metadata?.categories.length ?? '—'} categories · {metadata?.phrasing_count ?? '—'} phrasings{metadata?.learned_count ? ` (${metadata.learned_count} learned)` : ''}{metadata?.dataset?.license ? ` · ${metadata.dataset.license}` : ''}{metadata?.dataset?.source && <> · <a className="text-button" href={metadata.dataset.source} target="_blank" rel="noreferrer">source</a></>}</p></div>{metadata && <Tag><ShieldCheck size={12} /> Validated on startup</Tag>}</div>
    <div className="library-toolbar"><div className="search-field"><Search size={17} /><input aria-label="Search FAQs" placeholder="Search questions, answers or FAQ IDs…" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="Filter by category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{metadata?.categories.map(item => <option key={item.name}>{item.name}</option>)}</select></div>
    <div className="section-title"><h3>{filtered.length} {filtered.length === 1 ? 'FAQ' : 'FAQs'}</h3><span>Expand a question to read its answer</span></div>
    <div className="faq-list" style={{ ['--id-col' as string]: idWidth }}>{filtered.map(faq => <details className="panel faq-item" key={faq.faq_id}><summary><code>{faq.faq_id}</code><strong>{faq.question}</strong><Tag tone="gray">{faq.category}</Tag><ChevronDown size={16} /></summary><div className="faq-answer">{faq.answer}</div></details>)}</div>
    {filtered.length === 0 && <div className="empty-answer"><Search size={28} /><h3>No FAQs found</h3><p>Try another search term or category.</p><button className="secondary" onClick={() => { setQuery(''); setCategory(''); }}>Clear filters</button></div>}
    <p className="caption">{metadata?.dataset?.key === 'bitext' ? 'One FAQ per Bitext intent. Questions and intent labels come from the Bitext dataset; answers are condensed from its responses. This optional dataset is loaded with FAQ_DATASET=bitext; the default is the project FAQ dataset.' : 'To update the knowledge base, replace the CSV and restart the backend. Existing IDs and complete records are required.'}</p>
  </>;
}
