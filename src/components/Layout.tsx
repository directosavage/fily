import { ArrowLeft, FileText, Moon, ShieldCheck, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './ui/button';

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const inTool = pathname.startsWith('/tools/');
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('documax-theme', dark ? 'dark' : 'light');
  }, [dark]);
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
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setDark((value) => !value)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
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
