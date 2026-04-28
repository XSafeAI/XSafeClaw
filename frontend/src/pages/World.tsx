import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { systemAPI } from '../services/api';

export default function World() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await systemAPI.installStatus();
        if (cancelled) return;
        const d = res.data as any;

        if (!d.openclaw_installed && !d.nanobot_installed && !d.hermes_installed) {
          navigate('/setup', { replace: true });
          return;
        }
      } catch {
        // status failed — proceed to valley anyway
      }

      if (!cancelled) {
        const { search, hash } = window.location;
        window.location.replace(`/agent-valley.html${search}${hash}`);
      }
    })();

    return () => { cancelled = true; };
  }, [navigate]);

  return null;
}
