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
import ConfigureSelector from './pages/ConfigureSelector';
import NanobotConfigure from './pages/NanobotConfigure';
import { systemAPI, type InstallStatusResponse } from './services/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

type CheckState = 'pending' | 'setup' | 'openclaw_configure' | 'nanobot_configure' | 'configure_select' | 'ok';

const EXEMPT_PATHS = ['/setup', '/configure', '/openclaw_configure', '/nanobot_configure', '/configure_select'];

function configureStateForStatus(status: InstallStatusResponse): CheckState {
  const needsOpenClaw = Boolean(status.requires_configure);
  const needsNanobot = Boolean(status.requires_nanobot_configure);
  if (needsOpenClaw && needsNanobot) return 'configure_select';
  if (needsNanobot) return 'nanobot_configure';
  if (needsOpenClaw) return 'openclaw_configure';
  return 'ok';
}

function AppRoutes() {
  const [checkState, setCheckState] = useState<CheckState>('pending');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await systemAPI.installStatus();
        if (cancelled) return;
        const d = res.data as any;

        if (d.requires_setup || (!d.openclaw_installed && !d.nanobot_installed)) {
          setCheckState('setup');
        } else {
          setCheckState(configureStateForStatus(d));
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
    if (EXEMPT_PATHS.includes(currentPath)) return;

    if (checkState === 'setup') {
      navigate('/setup', { replace: true });
    } else if (checkState === 'openclaw_configure') {
      navigate('/openclaw_configure', { replace: true });
    } else if (checkState === 'nanobot_configure') {
      navigate('/nanobot_configure', { replace: true });
    } else if (checkState === 'configure_select') {
      navigate('/configure_select', { replace: true });
    }
  }, [checkState, location.pathname, navigate]);

  if (checkState === 'pending') return null;

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/configure" element={<Navigate to="/openclaw_configure" replace />} />
      <Route path="/openclaw_configure" element={<Configure />} />
      <Route path="/nanobot_configure" element={<NanobotConfigure />} />
      <Route path="/configure_select" element={<ConfigureSelector />} />
      <Route path="/agent-town" element={<World />} />
      <Route path="/agent-valley" element={<World />} />
      <Route path="/world" element={<World />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/agent-valley" replace />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/instances" element={<Navigate to="/agent-valley" replace />} />
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
