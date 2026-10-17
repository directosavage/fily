import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import Home from './pages/Home';
import Layout from './components/Layout';

const ToolPage = lazy(() => import('./pages/ToolPage'));

function Loading() {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>Opening your workspace…</span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tools/:slug" element={<ToolPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
