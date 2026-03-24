import { useEffect } from 'react';

export default function World() {
  useEffect(() => {
    const { search, hash } = window.location;
    window.location.replace(`/agent-town.html${search}${hash}`);
  }, []);

  return null;
}
