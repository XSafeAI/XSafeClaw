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

        const anyInstalled = d.openclaw_installed || d.nanobot_installed;
        if (!anyInstalled) {
          navigate('/setup', { replace: true });
          return;
        }
        if (d.requires_configure && d.requires_nanobot_configure) {
          navigate('/configure_select', { replace: true });
          return;
        }
        if (d.requires_nanobot_configure) {
          navigate('/nanobot_configure', { replace: true });
          return;
        }
        if (d.requires_configure) {
          navigate('/openclaw_configure', { replace: true });
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
