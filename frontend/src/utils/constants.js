export const api = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:4000';

export const fallbackStocks = [
  { symbol: 'AAPL', lastPrice: 189.84, change: 1.28 },
  { symbol: 'RELIANCE', lastPrice: 2935.4, change: 0.82 },
  { symbol: 'INFY', lastPrice: 1492.65, change: -0.36 },
  { symbol: 'TCS', lastPrice: 4125.1, change: 0.54 },
  { symbol: 'HDFCBANK', lastPrice: 1684.25, change: -0.21 },
  { symbol: 'GOOGL', lastPrice: 175.43, change: 0.95 },
  { symbol: 'AMZN', lastPrice: 228.72, change: -0.44 },
  { symbol: 'MSFT', lastPrice: 468.55, change: 1.12 },
  { symbol: 'NVDA', lastPrice: 131.88, change: 2.35 },
  { symbol: 'META', lastPrice: 622.73, change: -0.88 },
  { symbol: 'TSLA', lastPrice: 248.42, change: -1.56 },
  { symbol: 'SBI', lastPrice: 845.6, change: 0.33 },
  { symbol: 'ICICIBANK', lastPrice: 1245.3, change: -0.15 }
];

export const money = (value, maximumFractionDigits = 2) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits
}).format(Number(value ?? 0));

export const compactNumber = (value) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));

export const percent = (value) => `${Number(value ?? 0) >= 0 ? '+' : ''}${Number(value ?? 0).toFixed(2)}%`;

export const dateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const time = (value) => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
