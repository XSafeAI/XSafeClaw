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
import Approvals from './pages/Approvals';
import Setup from './pages/Setup';
import Configure from './pages/Configure';
import ConfigureSelector from './pages/ConfigureSelector';
import NanobotConfigure from './pages/NanobotConfigure';
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

// §42: the §38 framework picker is gone — XSafeClaw monitors OpenClaw,
// Hermes and Nanobot simultaneously and the user picks per-session in
// Agent Town. We only need the install / configure routing now.
//
// §51: forced auto-redirect to ``*_configure`` removed. Configure is
// reachable only via Setup cards / post-install auto-jump.
//
// §57: Per product spec — ``xsafeclaw start`` must land the user on
// ``/setup`` regardless of install status. The CLI handles the initial
// browser open; App.tsx here enforces the same contract for the first
// visit of each browser session (page refresh / deep-link / type-in
// URL). A ``sessionStorage`` flag is flipped on once the user reaches
// Setup so subsequent navigations to Monitor / Chat / Agent Valley are
// not hijacked.
type CheckState = 'pending' | 'setup' | 'ok';

// EXEMPT_PATHS: pages the initial ``setup`` redirect must not kick the
// user out of (Setup itself + every Configure entry, in case they're
// mid-config of a freshly installed framework, plus the landing app
// shell pages Setup itself links to via the new "enter town / enter
// backend" shortcuts).
const EXEMPT_PATHS = [
  '/setup',
  '/configure',
  '/openclaw_configure',
  '/hermes_configure',
  '/nanobot_configure',
  '/configure_select',
];

const SETUP_VISITED_KEY = 'xsafeclaw:setup_visited';

function AppRoutes() {
  const [checkState, setCheckState] = useState<CheckState>('pending');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Still probe install-status so the backend is awake before we
        // commit to a route. We intentionally ignore the result: §57
        // requires landing on ``/setup`` regardless of install flags.
        await systemAPI.installStatus();
        if (cancelled) return;
      } catch {
        /* swallow — fall through to the Setup redirect anyway */
      }
      if (cancelled) return;

      let visited = false;
      try {
        visited = sessionStorage.getItem(SETUP_VISITED_KEY) === '1';
      } catch {
        /* sessionStorage unavailable (incognito etc.) — treat as first visit */
      }
      setCheckState(visited ? 'ok' : 'setup');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (checkState === 'pending') return;
    const currentPath = location.pathname;

    // Record the visit once the user actually reaches Setup so later
    // navigations (Enter Town / Enter Backend) aren't bounced back.
    if (currentPath === '/setup') {
      try {
        sessionStorage.setItem(SETUP_VISITED_KEY, '1');
      } catch {
        /* ignore */
      }
      if (checkState === 'setup') setCheckState('ok');
      return;
    }

    if (EXEMPT_PATHS.includes(currentPath)) return;

    if (checkState === 'setup') {
      navigate('/setup', { replace: true });
    }
  }, [checkState, location.pathname, navigate]);

  if (checkState === 'pending') return null;

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/configure" element={<Configure />} />
      <Route path="/openclaw_configure" element={<Configure />} />
      <Route path="/hermes_configure" element={<Configure />} />
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
        <Route path="/approvals" element={<Approvals />} />
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
