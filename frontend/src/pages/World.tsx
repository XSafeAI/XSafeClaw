import { useEffect } from 'react';

export default function World() {
  useEffect(() => {
    window.location.replace('/world.html');
  }, []);

  return null;
}
