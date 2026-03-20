import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useI18n } from './i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Monitor from './pages/Monitor';
import World from './pages/World';
import Assets from './pages/Assets';
import RiskScanner from './pages/RiskScanner';
import Chat from './pages/Chat';
import Setup from './pages/Setup';
import Configure from './pages/Configure';
import { systemAPI } from './services/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

type CheckState = 'pending' | 'setup' | 'configure' | 'ok';

const EXEMPT_PATHS = ['/setup', '/configure'];

function AppRoutes() {
  const [checkState, setCheckState] = useState<CheckState>('pending');
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    (async () => {
      try {
        const res = await systemAPI.status();
        const d = res.data as any;
        const currentPath = window.location.pathname;

        if (!d.openclaw_installed) {
          setCheckState('setup');
          if (!EXEMPT_PATHS.includes(currentPath)) {
            navigate('/setup', { replace: true });
          }
        } else if (!d.config_exists) {
          setCheckState('configure');
          if (!EXEMPT_PATHS.includes(currentPath)) {
            navigate('/configure', { replace: true });
          }
        } else {
          setCheckState('ok');
        }
      } catch {
        setCheckState('ok');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard: redirect if state doesn't match page
  useEffect(() => {
    if (EXEMPT_PATHS.includes(location.pathname)) return;
    if (checkState === 'setup') navigate('/setup', { replace: true });
    else if (checkState === 'configure') navigate('/configure', { replace: true });
  }, [checkState, location.pathname, navigate]);

  if (checkState === 'pending') {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="XSafeClaw" className="w-14 h-14 rounded-xl animate-pulse" />
          <p className="text-text-muted text-sm">{t.common.startingApp}</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/configure" element={<Configure />} />
      <Route path="/world" element={<World />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Monitor />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/safety-rehearsal" element={<RiskScanner />} />
        <Route path="/chat" element={<Chat />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
