import { BookOpen, CircleHelp, FlaskConical, LineChart, Map as MapIcon, Menu, MessageSquareText, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice, Spinner } from './components/Shared';
import { AboutPage } from './pages/About';
import { EvaluationPage } from './pages/Evaluation';
import { InsightsPage } from './pages/Insights';
import { SemanticMapPage } from './pages/SemanticMap';
import { LibraryPage } from './pages/Library';
import { SearchPage } from './pages/Search';
import { api, errorMessage } from './services/api';
import type { FAQ, Metadata, Remote } from './types';

const pages = [
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'knowledge', label: 'FAQ dataset', Icon: BookOpen },
  { id: 'map', label: 'Semantic map', Icon: MapIcon },
  { id: 'insights', label: 'Insights', Icon: LineChart },
  { id: 'evaluation', label: 'Evaluation', Icon: FlaskConical },
  { id: 'about', label: 'Method', Icon: CircleHelp },
];
function pageFromHash() { const hash = window.location.hash.slice(1); return pages.some(p => p.id === hash) ? hash : 'search'; }

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [threshold, setThreshold] = useState(0.45);
  const [remote, setRemote] = useState<Remote<{ metadata: Metadata; faqs: FAQ[] }>>({ kind: 'loading' });
  const load = useCallback(async (signal?: AbortSignal) => {
    setRemote({ kind: 'loading' });
    try {
      const [metadata, faqs] = await Promise.all([api.metadata(signal), api.faqs(signal)]);
      setRemote({ kind: 'success', data: { metadata, faqs } });
    } catch (error) { if (!signal?.aborted) setRemote({ kind: 'error', message: errorMessage(error) }); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { const change = () => { setPage(pageFromHash()); setMobileMenu(false); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const metadata = remote.kind === 'success' ? remote.data.metadata : null;
  const faqs = remote.kind === 'success' ? remote.data.faqs : [];
  return <div className="app-shell">
    {mobileMenu && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}><a className="brand" href="#search"><span className="brand-mark"><MessageSquareText size={18} /></span><span>FAQ Matcher</span></a>
      <nav aria-label="Main navigation">{pages.map(({ id, label, Icon }) => <a key={id} href={`#${id}`} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{id === 'knowledge' && metadata && <small>{metadata.faq_count}</small>}</a>)}</nav>
      
      <div className="sidebar-bottom"><div className="model-status"><span className={`status-dot ${remote.kind === 'success' ? 'online' : ''}`} /><div><strong>{remote.kind === 'success' ? 'Model loaded' : remote.kind === 'loading' ? 'Loading model…' : 'Backend unavailable'}</strong><span>all-MiniLM-L6-v2</span></div>{remote.kind === 'loading' && <Spinner />}</div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><button className="menu-button" aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button><strong>{pages.find(p => p.id === page)?.label}</strong></div><span className="topbar-meta">PS 47 · Semantic FAQ Matcher</span></header>
      <main className={page === 'search' ? 'main-content search-content' : 'main-content'}>
        {remote.kind === 'error' && <ErrorNotice message={remote.message} retry={() => void load()} />}
        {page === 'search' && <SearchPage metadata={metadata} faqs={faqs} threshold={threshold} setThreshold={setThreshold} />}
        {page === 'knowledge' && (remote.kind === 'loading' ? <div className="empty-answer"><Spinner /><h3>Loading your knowledge base…</h3></div> : <LibraryPage metadata={metadata} faqs={faqs} />)}
        {page === 'map' && <SemanticMapPage metadata={metadata} />}
        {page === 'insights' && <InsightsPage onLearnedReset={() => void load()} />}
        {page === 'evaluation' && <EvaluationPage metadata={metadata} threshold={threshold} setThreshold={setThreshold} />}
        {page === 'about' && <AboutPage metadata={metadata} />}
      </main><footer className="app-footer"><span>all-MiniLM-L6-v2 · sentence-transformers</span><span>FastAPI + React</span></footer>
    </div>
  </div>;
}
