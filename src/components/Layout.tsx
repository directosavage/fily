import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const inTool = pathname.startsWith('/tools/');
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/" aria-label="DocuMax home">
            <span className="brand-mark" aria-hidden="true">
              <FileText size={20} strokeWidth={2.2} />
              <span className="brand-spark">+</span>
            </span>
            <span>Docu<span className="brand-accent">Max</span></span>
          </Link>
          <div className="topbar-actions">
            {inTool && (
              <Link className="back-link" to="/">
                <ArrowLeft size={16} /> <span>All tools</span>
              </Link>
            )}
            <span className="privacy-pill"><ShieldCheck size={15} /> Private by design</span>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <span className="brand-mini"><span className="brand-accent">Docu</span>Max</span>
        <span>Files are processed on your device</span>
      </footer>
    </div>
  );
}
