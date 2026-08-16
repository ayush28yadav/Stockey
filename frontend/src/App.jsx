import { useState, useEffect, useCallback } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { usePath } from './hooks/usePath.jsx';
import {
  AppShell,
  Brand,
  Dashboard,
  Login,
  Orders,
  Portfolio,
  Toast
} from './components/index.js';
import { fallbackStocks } from './utils/constants.js';

const api = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:4000';

function App() {
  const [path, navigate] = usePath();
  const [theme, setTheme] = useState(() => localStorage.getItem('stockey-theme') ?? 'dark');
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [stocks, setStocks] = useState(fallbackStocks);
  const [toast, setToast] = useState(null);

  const toggleTheme = useCallback(() => setTheme((current) => current === 'dark' ? 'light' : 'dark'), []);
  const showToast = useCallback((text, tone = 'success') => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('stockey-theme', theme);
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${api}/api/users/me`, { credentials: 'include', signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          if (path === '/login' || path === '/auth/callback') navigate('/');
        } else if (path === '/auth/callback') {
          showToast('Sign-in could not be completed.', 'error');
        }
      } finally {
        setAuthLoading(false);
      }
    })();
    return () => controller.abort();
  }, [path, navigate, showToast]);

  const request = useCallback(async (endpoint, options = {}) => fetch(`${api}${endpoint}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers ?? {})
    }
  }), [accessToken]);

  const onAuthenticated = useCallback((nextUser, token) => {
    setUser(nextUser);
    setAccessToken(token);
    navigate('/');
  }, [navigate]);

  const logout = useCallback(async () => {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setAccessToken(null);
    navigate('/login');
  }, [request, navigate]);

  if (authLoading) return <div className="app-loader"><Brand /><span>Preparing your market workspace…</span></div>;
  if (!user) return <><Login onAuthenticated={onAuthenticated} theme={theme} toggleTheme={toggleTheme} /><Toast toast={toast} close={() => setToast(null)} /></>;

  const view = path === '/portfolio'
    ? <Portfolio request={request} showToast={showToast} setSelectedSymbol={setSelectedSymbol} navigate={navigate} />
    : path === '/orders'
      ? <Orders request={request} showToast={showToast} setSelectedSymbol={setSelectedSymbol} navigate={navigate} />
      : <Dashboard request={request} theme={theme} selectedSymbol={selectedSymbol} setSelectedSymbol={setSelectedSymbol} stocks={stocks} setStocks={setStocks} showToast={showToast} />;

  return <ErrorBoundary>
    <AppShell
      path={path}
      navigate={navigate}
      theme={theme}
      toggleTheme={toggleTheme}
      user={user}
      setUser={setUser}
      onLogout={logout}
      stocks={stocks}
      setSelectedSymbol={setSelectedSymbol}
      request={request}
      showToast={showToast}
    >
      {view}
    </AppShell>
    <Toast toast={toast} close={() => setToast(null)} />
  </ErrorBoundary>;
}

export default App;
