import { useEffect } from 'react';

export default function World() {
  useEffect(() => {
    window.location.replace('/agent-town.html');
  }, []);

  return null;
}
