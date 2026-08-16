import { useState } from 'react';
import { Sun, Moon, X } from 'lucide-react';
import { Brand } from './Brand.jsx';
import { IconButton } from './IconButton.jsx';
import { api } from '../utils/constants.js';

export function Login({ onAuthenticated, theme, toggleTheme }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(new URLSearchParams(location.search).get('error') === 'oauth_failed' ? 'Google sign-in could not be completed. Please try again.' : '');

  async function submit(event) {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const response = await fetch(`${api}/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === 'EMAIL_ALREADY_REGISTERED' ? 'An account with this email already exists.' : data.error === 'INVALID_EMAIL_OR_PASSWORD' ? 'Incorrect email or password.' : 'Please use a valid email and a password of at least 12 characters.');
      onAuthenticated(data.user, data.accessToken);
    } catch (caught) { setError(caught.message || 'Unable to sign in.'); }
    finally { setLoading(false); }
  }

  return <main className="auth-page">
    <div className="auth-orb orb-one" /><div className="auth-orb orb-two" />
    <header className="auth-header"><Brand /><IconButton label="Toggle color theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton></header>
    <section className="auth-card">
      <div className="eyebrow">SIMULATED EXCHANGE</div>
      <h1>{mode === 'login' ? 'Welcome back.' : 'Start trading today.'}</h1>
      <p>Explore a real-time market in a calm, risk-free environment.</p>
      <button className="google-button" type="button" onClick={() => location.assign(`${api}/api/auth/google`)}><span className="google-mark">G</span> Continue with Google</button>
      <div className="divider"><span />or continue with email<span /></div>
      <form onSubmit={submit} className="auth-form">
        <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input required minLength="12" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></label>
        {error && <div className="form-error"><X size={15} />{error}</div>}
        <button className="primary-button full" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign in to Stockey' : 'Create your account'}</button>
      </form>
      <p className="auth-switch">{mode === 'login' ? 'New to Stockey?' : 'Already have an account?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
    </section>
    <p className="auth-footnote">Simulated trading only. No real money changes hands.</p>
  </main>;
}
