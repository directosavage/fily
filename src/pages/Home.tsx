import { useMemo, useState } from 'react';
import { ArrowRight, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { categories, categoryDescriptions, tools } from '../catalog';

export default function Home() {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tools.filter(
      (tool) =>
        !term ||
        `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(term),
    );
  }, [query]);

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> YOUR DOCUMENT WORKSPACE</div>
          <h1>Make every document<br /><span>work a little harder.</span></h1>
          <p>Scan, tidy, convert, and protect your files — all on your device, with no uploads.</p>
          <div className="hero-proof"><ShieldCheck size={16} /> Private processing, from the first page to the last</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-sheet sheet-back" />
          <div className="art-sheet sheet-front">
            <div className="sheet-logo"><FileMark /></div>
            <i /><i /><i />
            <div className="sheet-stamp"><ShieldCheck size={20} /></div>
          </div>
          <div className="art-chip chip-scan">SCAN READY</div>
          <div className="art-chip chip-pdf">PDF · 3 pages</div>
        </div>
      </section>

      <section className="tool-library" aria-label="Document tools">
        <div className="library-heading">
          <div>
            <div className="section-kicker">THE TOOLKIT</div>
            <h2>What would you like to do?</h2>
          </div>
          <label className="searchbox">
            <Search size={18} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search 26 tools"
              aria-label="Search tools"
            />
            {query && <button type="button" className="clear-search" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </label>
        </div>

        <div className="tool-categories">
          {categories.map((category) => {
            const categoryTools = filtered.filter((tool) => tool.category === category);
            if (!categoryTools.length) return null;
            return (
              <section className="category-section" key={category}>
                <div className="category-heading">
                  <h3>{category}</h3>
                  <p>{categoryDescriptions[category]}</p>
                </div>
                <div className="tool-grid">
                  {categoryTools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <Link to={`/tools/${tool.slug}`} className="tool-card" key={tool.slug}>
                        <span className={`tool-icon icon-${tool.category.toLowerCase()}`}><Icon size={20} strokeWidth={1.8} /></span>
                        <span className="tool-card-copy">
                          <strong>{tool.name}</strong>
                          <span>{tool.description}</span>
                        </span>
                        <ArrowRight size={16} className="card-arrow" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-search">
              <Search size={23} />
              <strong>No matching tools</strong>
              <span>Try another search, like “rotate” or “scan”.</span>
            </div>
          )}
        </div>
      </section>
      <aside className="privacy-banner">
        <span className="privacy-banner-icon"><ShieldCheck size={19} /></span>
        <div><strong>Your documents stay yours.</strong><span>DocuMax works right in your browser. Your files aren’t uploaded or stored by us.</span></div>
        <span className="privacy-banner-badge">ON-DEVICE PROCESSING</span>
      </aside>
    </div>
  );
}

function FileMark() {
  return <svg width="25" height="30" viewBox="0 0 25 30" fill="none"><path d="M4 1.5h11l7 7V28H4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M15 2v7h7M8 15h10M8 19h10M8 23h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}
