import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Home from './pages/Home';
import Monitor from './pages/Monitor';
import World from './pages/World';
import Assets from './pages/Assets';
import RiskScanner from './pages/RiskScanner';
import Chat from './pages/Chat';
import Setup from './pages/Setup';
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

/* ── System check wrapper ── */
type CheckState = 'pending' | 'setup' | 'ok';

/** Pages that should NOT be redirected to /setup when openclaw is missing */
const SETUP_EXEMPT = ['/setup'];
/** Pages that should NOT be redirected to /home on fresh load */
const HOME_ENTRY_PATHS = ['/', '/home'];

function AppRoutes() {
  const [checkState, setCheckState] = useState<CheckState>('pending');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    (async () => {
      try {
        const res = await systemAPI.status();
        if (res.data.openclaw_installed) {
          setCheckState('ok');
          // If user is on the root path, send them to the home landing page
          if (HOME_ENTRY_PATHS.includes(location.pathname)) {
            navigate('/home', { replace: true });
          }
        } else {
          setCheckState('setup');
          if (!SETUP_EXEMPT.includes(location.pathname)) {
            navigate('/setup', { replace: true });
          }
        }
      } catch {
        // Backend not yet available – let the app load normally
        setCheckState('ok');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard: bounce back to /setup if openclaw disappears
  useEffect(() => {
    if (checkState === 'setup' && !SETUP_EXEMPT.includes(location.pathname)) {
      navigate('/setup', { replace: true });
    }
  }, [checkState, location.pathname, navigate]);

  const handleSetupComplete = () => {
    setCheckState('ok');
    navigate('/home', { replace: true });
  };

  if (checkState === 'pending') {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-lg animate-pulse">
            S
          </div>
          <p className="text-text-muted text-sm">Starting SafeClaw…</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Setup page – full-screen, no sidebar */}
      <Route path="/setup" element={<Setup onComplete={handleSetupComplete} />} />

      {/* Home landing page – full-screen, no sidebar */}
      <Route path="/home" element={<Home />} />
      <Route path="/world" element={<World />} />

      {/* Main app with sidebar */}
      <Route element={<Layout />}>
        <Route path="/"            element={<Monitor />} />
        <Route path="/monitor"     element={<Monitor />} />
        <Route path="/assets"      element={<Assets />} />
        <Route path="/risk-scanner" element={<RiskScanner />} />
        <Route path="/chat"        element={<Chat />} />
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
