import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:4000';
type User = { id: string; email: string; oauthProvider: string | null };

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState('');
  const isCallback = location.pathname === '/auth/callback';
  useEffect(() => {
    if (isCallback || location.pathname === '/') {
      fetch(`${api}/api/users/me`, { credentials: 'include' })
        .then(async (r) => r.ok ? r.json() : Promise.reject())
        .then((data) => { setUser(data.user); if (isCallback) history.replaceState({}, '', '/'); })
        .catch(() => { if (isCallback) setMessage('Sign-in could not be completed. Please try again.'); });
    }
  }, [isCallback]);
  if (user) return <main><h1>Welcome, {user.email}</h1><p>You are signed in. The dashboard comes in the next milestone.</p></main>;
  return <main><h1>Stockey</h1><p>{message || 'Sign in securely to start simulated trading.'}</p><button onClick={() => location.assign(`${api}/api/auth/google`)}>Continue with Google</button></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
