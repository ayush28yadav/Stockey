import { useState, useEffect } from 'react';

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    addEventListener('popstate', sync);
    return () => removeEventListener('popstate', sync);
  }, []);
  const navigate = (next) => {
    if (next === location.pathname) return;
    history.pushState({}, '', next);
    setPath(next);
  };
  return [path, navigate];
}
