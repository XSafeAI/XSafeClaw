import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Monitor from './pages/Monitor';
import World from './pages/World';
import Assets from './pages/Assets';
import RiskScanner from './pages/RiskScanner';
import RiskTest from './pages/RiskTest';
import Chat from './pages/Chat';
import Setup from './pages/Setup';
import Configure from './pages/Configure';
import SelectFramework from './pages/SelectFramework';
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

type CheckState = 'pending' | 'picker' | 'setup' | 'configure' | 'ok';

// Paths that bypass the install-status redirect. /select-framework is here so
// that when the picker-mode guard forwards the user to it, our secondary
// /setup /configure redirects don't bounce them back out again.
const EXEMPT_PATHS = ['/setup', '/configure', '/select-framework'];
const PICKER_PATH = '/select-framework';

function AppRoutes() {
  const [checkState, setCheckState] = useState<CheckState>('pending');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // ── §38 picker-mode probe ────────────────────────────────────────
      // Runs BEFORE the install-status check: when the CLI supervisor
      // spawned the picker subprocess, /system/status is blocked by the
      // backend middleware and would throw, but /runtime-platform-status is
      // whitelisted. A 200 with picker_mode=true forces every route to
      // /select-framework until the real server boots.
      try {
        const pickerRes = await Promise.race([
          systemAPI.runtimePlatformStatus(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 2500)
          ),
        ]);
        if (cancelled) return;
        if (pickerRes.data.picker_mode) {
          setCheckState('picker');
          return;
        }
      } catch {
        // Endpoint may not exist on older backends — fall through.
      }

      try {
        const res = await Promise.race([
          systemAPI.status(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 3000)
          ),
        ]);
        if (cancelled) return;
        const d = res.data as any;

        if (!d.openclaw_installed && !d.hermes_installed) {
          setCheckState('setup');
        } else if (!d.config_exists) {
          setCheckState('configure');
        } else {
          setCheckState('ok');
        }
      } catch {
        if (!cancelled) setCheckState('ok');
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (checkState === 'pending') return;
    const currentPath = location.pathname;

    if (checkState === 'picker') {
      if (currentPath !== PICKER_PATH) {
        navigate(PICKER_PATH, { replace: true });
      }
      return;
    }

    if (EXEMPT_PATHS.includes(currentPath)) return;

    if (checkState === 'setup') {
      navigate('/setup', { replace: true });
    } else if (checkState === 'configure') {
      navigate('/configure', { replace: true });
    }
  }, [checkState, location.pathname, navigate]);

  if (checkState === 'pending') return null;

  return (
    <Routes>
      <Route path="/select-framework" element={<SelectFramework />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/configure" element={<Configure />} />
      <Route path="/agent-town" element={<World />} />
      <Route path="/agent-valley" element={<World />} />
      <Route path="/world" element={<World />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/agent-valley" replace />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/risk-test" element={<RiskTest />} />
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
