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

// §42: the §38 framework picker is gone — XSafeClaw monitors OpenClaw,
// Hermes and Nanobot simultaneously and the user picks per-session in
// Agent Town. We only need the install / configure routing now.
//
// §51: forced auto-redirect to ``*_configure`` removed. Per the user's
// updated routing contract (Case 1 / Case 2), the **only** flows that
// should land the user on a Configure page are:
//   1. user explicitly clicks【download】on a Setup card → after install
//      success, ``Setup.tsx`` itself navigates to that platform's
//      Configure (handled inside Setup.tsx, not here);
//   2. user explicitly clicks an installed Setup card → ``Setup.tsx``
//      calls ``navigate('/<platform>_configure')`` directly.
// Any other entry path (boot to ``/``, deep link to ``/agent-valley``,
// SET button in town, etc.) **must not** be hijacked by App.tsx based on
// stale ``requires_configure`` flags. The only auto-redirect kept is
// ``setup``: when nothing is installed at all, the app must force the
// user through Setup because the rest of the app cannot function.
type CheckState = 'pending' | 'setup' | 'ok';

// EXEMPT_PATHS still meaningful: pages the ``setup`` redirect must not
// kick the user out of (Setup itself + every Configure entry, in case
// they're mid-config of a freshly installed framework). Kept full on
// purpose — see §51 audit log for the "trim to only /setup breaks the
// post-install navigate" trap.
const EXEMPT_PATHS = [
  '/setup',
  '/configure',
  '/openclaw_configure',
  '/hermes_configure',
  '/nanobot_configure',
  '/configure_select',
];

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
        const d = res.data as InstallStatusResponse & {
          openclaw_installed?: boolean;
          hermes_installed?: boolean;
          nanobot_installed?: boolean;
        };

        const anyInstalled =
          d.openclaw_installed || d.nanobot_installed || d.hermes_installed;
        // §51: only ``requires_setup`` (or "nothing installed at all")
        // forces a redirect now. ``requires_configure`` and friends are
        // intentionally ignored — Configure is reachable only via Case 1
        // (post-install auto-jump from Setup) or Case 2 (clicking a
        // Setup card or the SET HUD button).
        if (d.requires_setup || !anyInstalled) {
          setCheckState('setup');
        } else {
          setCheckState('ok');
        }
      } catch {
        if (!cancelled) setCheckState('ok');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (checkState === 'pending') return;
    const currentPath = location.pathname;
    if (EXEMPT_PATHS.includes(currentPath)) return;

    // §51: only the ``setup`` branch survives — see the type comment
    // above for the rationale. Other branches (openclaw_configure,
    // hermes_configure, nanobot_configure, configure_select) used to
    // forcibly hijack the user; they're gone on purpose.
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
