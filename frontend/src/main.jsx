import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BriefcaseBusiness, CandlestickChart,
  Check, ChevronDown, CircleDollarSign, Clock3, Crosshair, Grid2X2, Home,
  LayoutDashboard, LineChart, LogOut, Menu, Moon, MoreHorizontal, PanelLeftClose,
  Plus, Search, Settings2, SlidersHorizontal, Sun, TrendingDown, TrendingUp, Wallet,
  X
} from 'lucide-react';
import './styles.css';

const api = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:4000';
const fallbackStocks = [
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

const money = (value, maximumFractionDigits = 2) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits
}).format(Number(value ?? 0));
const compactNumber = (value) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
const percent = (value) => `${Number(value ?? 0) >= 0 ? '+' : ''}${Number(value ?? 0).toFixed(2)}%`;
const dateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const time = (value) => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function usePath() {
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

function PriceChart({ trades, price, theme }) {
  const host = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!host.current) return undefined;
    const dark = theme === 'dark';
    const chart = createChart(host.current, {
      autoSize: true,
      height: 510,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: dark ? '#85909b' : '#6b7280', fontFamily: 'DM Mono, ui-monospace, monospace', fontSize: 11 },
      grid: { vertLines: { color: dark ? '#1e2228' : '#e6e8eb' }, horzLines: { color: dark ? '#1e2228' : '#e6e8eb' } },
      rightPriceScale: { borderColor: dark ? '#2a2e34' : '#d9dde2' },
      timeScale: { borderColor: dark ? '#2a2e34' : '#d9dde2', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { labelBackgroundColor: '#4b77d1' }, horzLine: { labelBackgroundColor: '#4b77d1' } }
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#19b34b', downColor: '#e55357', borderVisible: false,
      wickUpColor: '#19b34b', wickDownColor: '#e55357'
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => chart.remove();
  }, [theme]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const base = Number(price || trades[0]?.price || 100);
    const buckets = new Map();
    [...trades].reverse().forEach((trade, index) => {
      const timestamp = Math.floor(new Date(trade.created_at ?? trade.executedAt ?? Date.now()).getTime() / 1000 / 300) * 300;
      const candle = buckets.get(timestamp) ?? { time: timestamp, open: index ? null : base, high: -Infinity, low: Infinity, close: base };
      const value = Number(trade.price);
      candle.open ??= value;
      candle.high = Math.max(candle.high, value);
      candle.low = Math.min(candle.low, value);
      candle.close = value;
      buckets.set(timestamp, candle);
    });
    let data = [...buckets.values()].filter((candle) => Number.isFinite(candle.high));
    if (data.length < 2) {
      let previous = base * 0.987;
      data = Array.from({ length: 32 }, (_, index) => {
        const drift = Math.sin(index * 1.91) * base * 0.0027 + (index % 7 === 0 ? base * 0.003 : 0);
        const close = previous + drift;
        const candle = { time: Math.floor(Date.now() / 1000) - (31 - index) * 300, open: previous, high: Math.max(previous, close) + base * 0.0012, low: Math.min(previous, close) - base * 0.0012, close };
        previous = close;
        return candle;
      });
    }
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [trades, price]);

  return <div className="chart-host" ref={host} aria-label="Five minute candlestick price chart" />;
}

function IconButton({ label, children, ...props }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} {...props}>{children}</button>;
}

function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }) {
  return <div className="empty-state"><Activity size={20} /><strong>{title}</strong><span>{detail}</span></div>;
}

function Login({ onAuthenticated, theme, toggleTheme }) {
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

function Brand({ compact = false }) {
  return <div className="brand"><span className="brand-mark"><TrendingUp size={18} strokeWidth={2.7} /></span>{!compact && <span>stockey</span>}</div>;
}

function AppShell({ path, navigate, theme, toggleTheme, user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const nav = [{ to: '/', label: 'Trading terminal', icon: CandlestickChart }, { to: '/portfolio', label: 'Portfolio', icon: BriefcaseBusiness }, { to: '/orders', label: 'Orders', icon: ArrowDownRight }];
  const selectNav = (to) => { navigate(to); setMobileOpen(false); };
  return <div className="terminal-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="rail-brand"><Brand compact /></div>
      <nav><button className={path === '/' ? 'active' : ''} onClick={() => selectNav('/')} aria-label="Trading terminal" title="Trading terminal"><Home size={19} /></button><button aria-label="Markets" title="Markets"><ArrowLeftRightIcon /></button><button className={path === '/portfolio' ? 'active' : ''} onClick={() => selectNav('/portfolio')} aria-label="Portfolio" title="Portfolio"><PieIcon /></button><button className={path === '/orders' ? 'active' : ''} onClick={() => selectNav('/orders')} aria-label="Orders" title="Orders"><CandlestickChart size={19} /></button><button aria-label="Alerts" title="Alerts"><Bell size={18} /></button></nav>
      <div className="sidebar-bottom"><button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'} title={theme === 'dark' ? 'Use light mode' : 'Use dark mode'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><button onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div>
    </aside>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <section className="app-content"><header className="topbar"><IconButton label="Open navigation" className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></IconButton><label className="terminal-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock…" /><kbd>⌘ K</kbd></label><div className="topbar-actions"><div className="terminal-balance"><Wallet size={15} />{money(100000)}</div><IconButton label="Add funds"><Plus size={18} /></IconButton><IconButton label="Notifications"><Bell size={18} /></IconButton><button className="avatar-button" title={user.email}>{user.email.slice(0, 1).toUpperCase()}</button></div></header><main className="page-content">{children}</main></section>
  </div>;
}

function ArrowLeftRightIcon() { return <SlidersHorizontal size={19} />; }
function PieIcon() { return <Activity size={19} />; }

function Dashboard({ request, theme, selectedSymbol, setSelectedSymbol, stocks, setStocks, showToast }) {
  const [book, setBook] = useState({ bids: [], asks: [] });
  const [trades, setTrades] = useState([]);
  const [lastPrice, setLastPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [side, setSide] = useState('buy');
  const [orderType, setOrderType] = useState('limit');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [placing, setPlacing] = useState(false);

  const selectedStock = stocks.find((stock) => stock.symbol === selectedSymbol) ?? fallbackStocks[0];
  const displayedPrice = lastPrice || selectedStock.lastPrice || 0;

  const loadMarket = async () => {
    setLoading(true);
    try {
      const [bookResponse, tradeResponse, stockResponse] = await Promise.all([request(`/api/orderbook/${selectedSymbol}`), request(`/api/trades/${selectedSymbol}`), request('/api/stocks')]);
      if (bookResponse.ok) { const data = await bookResponse.json(); setBook({ bids: data.bids ?? [], asks: data.asks ?? [] }); }
      if (tradeResponse.ok) { const data = await tradeResponse.json(); setTrades(data.trades ?? []); if (data.trades?.[0]?.price) setLastPrice(Number(data.trades[0].price)); }
      if (stockResponse.ok) { const data = await stockResponse.json(); if (data.stocks?.length) { const apiMap = new Map(data.stocks.map((s) => [s.symbol, s])); setStocks(fallbackStocks.map((fb) => { const apiStock = apiMap.get(fb.symbol); return { ...fb, ...apiStock, lastPrice: apiStock?.lastPrice ?? fb.lastPrice, change: apiStock?.change ?? fb.change, updatedAt: apiStock?.updatedAt }; })); } }
    } catch { showToast('Market data is temporarily unavailable. Showing the last known view.', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadMarket(); }, [selectedSymbol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const socket = io(api, { query: { symbol: selectedSymbol }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('orderbook:update', (payload) => {
      const trade = { id: payload.timestamp, price: payload.price, quantity: payload.executedQuantity, created_at: payload.timestamp };
      setLastPrice(Number(payload.price)); setTrades((current) => [trade, ...current].slice(0, 50));
      loadMarket();
    });
    return () => socket.disconnect();
  }, [selectedSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  async function placeOrder(event) {
    event.preventDefault();
    if (!Number(quantity) || (orderType === 'limit' && !Number(price))) return showToast('Enter a valid quantity and limit price.', 'error');
    setPlacing(true);
    try {
      const response = await request('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': makeKey() }, body: JSON.stringify({ stockSymbol: selectedSymbol, side, orderType, quantity: Number(quantity), ...(orderType === 'limit' ? { price: Number(price) } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Order could not be placed.');
      showToast(`${side === 'buy' ? 'Buy' : 'Sell'} order submitted for ${selectedSymbol}.`, 'success');
      setPrice(''); loadMarket();
    } catch (caught) { showToast(caught.message, 'error'); }
    finally { setPlacing(false); }
  }

  const spread = book.asks[0] && book.bids[0] ? Number(book.asks[0].price) - Number(book.bids[0].price) : null;
  return <section className="terminal-dashboard">
    <article className="terminal-panel terminal-chart-panel">
      <header className="instrument-header"><span className="instrument-logo">{selectedSymbol.slice(0, 1)}</span><strong>{selectedSymbol}</strong><span className="instrument-price">{money(displayedPrice)}</span><span className={selectedStock.change >= 0 ? 'quote-up' : 'quote-down'}>{selectedStock.change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{percent(selectedStock.change)}</span><MoreHorizontal size={18} className="header-more" /></header>
      <div className="chart-toolbar"><button><Plus size={16} /></button><button className="timeframe">D</button><span className="toolbar-rule" /><button><CandlestickChart size={17} /></button><button><LineChart size={17} /></button><button className="toolbar-text">Indicators</button><button><Grid2X2 size={16} /></button><span className="toolbar-space" /><button><Crosshair size={17} /></button><button><Settings2 size={17} /></button><button><MoreHorizontal size={17} /></button></div>
      <div className="chart-stage"><div className="drawing-rail"><Crosshair size={17} /><LineChart size={17} /><SlidersHorizontal size={17} /><Activity size={17} /></div><PriceChart trades={trades} price={displayedPrice} theme={theme} /></div>
      <footer className="terminal-chart-footer"><div><button className="active">1D</button><button>5D</button><button>1M</button><button>3M</button><button>6M</button><button>YTD</button><button>1Y</button><button>All</button></div><span><i className={connected ? 'live-dot' : 'offline-dot'} />{connected ? 'Live' : 'Reconnecting'} · {trades[0] ? time(trades[0].created_at) : 'Waiting for market data'}</span></footer>
    </article>
    <section className="terminal-middle-column">
      <TradeTape trades={trades} loading={loading} />
      <OrderBook book={book} spread={spread} loading={loading} />
      <article className="terminal-panel watchlist-panel"><header className="panel-title"><strong>All Watchlist</strong><ChevronDown size={15} /><span /><Plus size={17} /><MoreHorizontal size={18} /></header><div className="watchlist">{stocks.map((stock, index) => <button key={stock.symbol} onClick={() => setSelectedSymbol(stock.symbol)} className={stock.symbol === selectedSymbol ? 'selected' : ''}><span className={`watch-icon icon-${index}`}>{stock.symbol.slice(0, 1)}</span><span className="watch-name"><strong>{stock.symbol}</strong><small>NSE</small></span><span className={(stock.change ?? 0) >= 0 ? 'spark up' : 'spark down'}>⌁⌁⌁⌁</span><span className="watch-price">{money(stock.lastPrice)}<small className={(stock.change ?? 0) >= 0 ? 'quote-up' : 'quote-down'}>{percent(stock.change)}</small></span></button>)}</div></article>
    </section>
    <article className="terminal-panel trade-ticket"><header className="panel-title"><strong>Trade</strong><MoreHorizontal size={19} /></header><div className="ticket-instrument"><span className="instrument-logo">{selectedSymbol.slice(0, 1)}</span><strong>{selectedSymbol}</strong><span>{money(displayedPrice)}</span><small className={selectedStock.change >= 0 ? 'quote-up' : 'quote-down'}>{percent(selectedStock.change)}</small></div><form onSubmit={placeOrder}><div className="ticket-toggle"><button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>Buy</button><button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>Sell</button></div><label className="ticket-field"><span>Type</span><select value={orderType} onChange={(event) => setOrderType(event.target.value)}><option value="limit">Limit Order</option><option value="market">Market Order</option></select></label>{orderType === 'limit' && <label className="ticket-field"><span>Order limit</span><div className="stepper"><button type="button" onClick={() => setPrice(String(Math.max(0, Number(price || displayedPrice) - .01).toFixed(2)))}>−</button><input min="0.01" step="0.01" type="number" placeholder={displayedPrice?.toFixed(2)} value={price} onChange={(event) => setPrice(event.target.value)} /><button type="button" onClick={() => setPrice(String((Number(price || displayedPrice) + .01).toFixed(2)))}>+</button></div></label>}<label className="ticket-field"><span>Shares</span><div className="stepper"><button type="button" onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>−</button><input min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><button type="button" onClick={() => setQuantity(String(Number(quantity) + 1))}>+</button></div></label><label className="ticket-field"><span>Expiry</span><select><option>Good for Day</option></select></label><div className="ticket-total"><span>Order total</span><strong>{money((orderType === 'limit' ? Number(price) : displayedPrice) * Number(quantity || 0))}</strong></div><div className="allocation"><div><i /><i /><i /><i /></div><span>Bid <b>70%</b></span><span>Ask <b>30%</b></span></div><button className={`ticket-submit ${side}`} disabled={placing}>{placing ? 'Placing order…' : side === 'buy' ? `Buy ${selectedSymbol}` : `Sell ${selectedSymbol}`}</button><p className="ticket-note">Simulated exchange · no real money</p></form></article>
    <footer className="market-ticker">{stocks.map((stock) => <button onClick={() => setSelectedSymbol(stock.symbol)} key={stock.symbol}><b>{stock.symbol}</b> {money(stock.lastPrice)} <em className={(stock.change ?? 0) >= 0 ? 'quote-up' : 'quote-down'}>{percent(stock.change)}</em></button>)}<span><Activity size={15} />{time(new Date())}</span></footer>
  </section>;
}

function OrderBook({ book, spread, loading }) {
  const side = (title, entries, tone) => <div className={`book-side ${tone}`}><div className="book-label"><span>{title}</span><span>Price</span><span>Qty</span></div>{entries.length ? entries.slice(0, 5).map((order) => <div className="book-row" key={order.id}><i style={{ width: `${Math.min(100, Math.max(18, Number(order.remaining) / 10))}%` }} /><strong>{money(order.price)}</strong><span>{compactNumber(order.remaining)}</span></div>) : <p className="book-empty">No {title.toLowerCase()} available</p>}</div>;
  return <article className="terminal-panel depth-panel"><header className="panel-title"><strong>Market depth</strong><Badge tone="success">Live</Badge></header>{loading ? <EmptyState title="Loading depth" detail="Fetching order book" /> : <div className="book-content">{side('Asks', book.asks, 'asks')}<div className="spread-row"><span>Spread</span><strong>{spread === null ? '—' : money(spread)}</strong></div>{side('Bids', book.bids, 'bids')}</div>}</article>;
}

function TradeTape({ trades, loading }) {
  return <article className="terminal-panel tape-card"><header className="panel-title"><strong>Running trade</strong><span /><CircleDollarSign size={17} /><SlidersHorizontal size={17} /><MoreHorizontal size={18} /></header><div className="quote-stats"><span>Open<b>—</b></span><span>High<b>—</b></span><span>Low<b>—</b></span><span>Vol<b>{compactNumber(trades.reduce((total, trade) => total + Number(trade.quantity || 0), 0) || 0)}</b></span></div>{loading ? <EmptyState title="Loading trades" detail="Fetching executions" /> : trades.length ? <div className="tape-list"><div className="tape-columns"><span>Time</span><span>Price</span><span>Action</span><span>Volume</span></div>{trades.slice(0, 9).map((trade, index) => <div className="tape-row" key={trade.id}><time>{time(trade.created_at)}</time><strong className={index % 3 === 0 ? 'quote-down' : 'quote-up'}>{money(trade.price)}</strong><span className={index % 3 === 0 ? 'quote-down' : 'quote-up'}>{index % 3 === 0 ? 'Sell' : 'Buy'}</span><b>{money(Number(trade.price) * Number(trade.quantity))}</b></div>)}</div> : <EmptyState title="No executions yet" detail="Live prints appear here." />}</article>;
}

function Portfolio({ request, showToast, setSelectedSymbol, navigate }) {
  const [portfolio, setPortfolio] = useState(null); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const response = await request('/api/users/portfolio'); if (!response.ok) throw new Error(); setPortfolio(await response.json()); } catch { showToast('Could not load your portfolio.', 'error'); } finally { setLoading(false); } })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const holdings = portfolio?.holdings ?? []; const invested = holdings.reduce((total, holding) => total + holding.marketValue, 0); const totalValue = invested + Number(portfolio?.cashBalance ?? 0);
  return <><section className="page-hero"><div><div className="eyebrow">YOUR POSITIONS</div><h2>Portfolio performance</h2><p>Your cash balance and live holdings, all in one view.</p></div><button className="primary-button" onClick={() => navigate('/') }><Plus size={17} />Place order</button></section><section className="metrics-grid"><Metric icon={<Wallet />} label="Portfolio value" value={money(totalValue)} /><Metric icon={<BriefcaseBusiness />} label="Invested value" value={money(invested)} /><Metric icon={<TrendingUp />} label="Unrealised P&L" value={money(portfolio?.totalPnl ?? 0)} tone={(portfolio?.totalPnl ?? 0) >= 0 ? 'positive' : 'negative'} /><Metric icon={<Activity />} label="Available cash" value={money(portfolio?.cashBalance ?? 0)} /></section><article className="card table-card"><div className="card-header"><div><p className="card-kicker">HOLDINGS</p><h3>Your positions</h3></div><Badge>{holdings.length} assets</Badge></div>{loading ? <EmptyState title="Loading portfolio" detail="Calculating your latest position values" /> : holdings.length ? <div className="table-scroll"><table><thead><tr><th>Instrument</th><th>Quantity</th><th>Avg. cost</th><th>Current price</th><th>Market value</th><th>P&L</th><th /></tr></thead><tbody>{holdings.map((holding) => <tr key={holding.stockSymbol}><td><button className="symbol-button" onClick={() => { setSelectedSymbol(holding.stockSymbol); navigate('/'); }}>{holding.stockSymbol}<small>NSE</small></button></td><td>{holding.quantity}</td><td>{money(holding.avgBuyPrice)}</td><td>{money(holding.currentPrice)}</td><td>{money(holding.marketValue)}</td><td className={holding.pnl >= 0 ? 'positive' : 'negative'}><strong>{money(holding.pnl)}</strong><small>{percent((holding.currentPrice - holding.avgBuyPrice) / holding.avgBuyPrice * 100)}</small></td><td><button className="row-action" onClick={() => { setSelectedSymbol(holding.stockSymbol); navigate('/'); }}>Trade</button></td></tr>)}</tbody></table></div> : <EmptyState title="Your portfolio is waiting" detail="Place your first simulated order to start building holdings." />}</article></>;
}

function Metric({ icon, label, value, tone }) { return <article className="metric-card"><span className={`metric-icon ${tone ?? ''}`}>{icon}</span><p>{label}</p><strong className={tone}>{value}</strong></article>; }

function Orders({ request, showToast }) {
  const [orders, setOrders] = useState([]); const [filter, setFilter] = useState('all'); const [loading, setLoading] = useState(true); const [cancelling, setCancelling] = useState(null);
  const load = async () => { setLoading(true); try { const query = filter === 'all' ? '' : `?status=${filter}`; const response = await request(`/api/orders${query}`); if (!response.ok) throw new Error(); const data = await response.json(); setOrders(data.orders ?? []); } catch { showToast('Could not load your order history.', 'error'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = async (id) => { setCancelling(id); try { const response = await request(`/api/orders/${id}`, { method: 'DELETE' }); const data = await response.json(); if (!response.ok) throw new Error(data.error === 'ORDER_NOT_CANCELLABLE' ? 'This order is no longer cancellable.' : 'Could not cancel order.'); showToast('Order cancelled.', 'success'); load(); } catch (caught) { showToast(caught.message, 'error'); } finally { setCancelling(null); } };
  return <><section className="page-hero"><div><div className="eyebrow">ACTIVITY</div><h2>Orders</h2><p>Review every submitted order and manage open positions.</p></div><div className="order-summary"><span>Open orders</span><strong>{orders.filter((order) => ['open', 'partially_filled'].includes(order.status)).length}</strong></div></section><article className="card table-card"><div className="card-header"><div><p className="card-kicker">ORDER HISTORY</p><h3>All orders</h3></div><div className="filter-group">{['all', 'open', 'filled', 'cancelled'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item.replace('_', ' ')}</button>)}</div></div>{loading ? <EmptyState title="Loading orders" detail="Retrieving your trading activity" /> : orders.length ? <div className="table-scroll"><table><thead><tr><th>Instrument</th><th>Side</th><th>Type</th><th>Price</th><th>Filled</th><th>Status</th><th>Placed</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.stockSymbol}</strong></td><td><Badge tone={order.side === 'buy' ? 'success' : 'danger'}>{order.side}</Badge></td><td className="capitalize">{order.orderType}</td><td>{order.price === null ? 'Market' : money(order.price)}</td><td>{order.filledQuantity} / {order.quantity}</td><td><Badge tone={order.status === 'filled' ? 'success' : order.status === 'cancelled' ? 'neutral' : 'warning'}>{order.status.replace('_', ' ')}</Badge></td><td>{dateTime(order.createdAt)}</td><td>{['open', 'partially_filled'].includes(order.status) && <button className="cancel-button" disabled={cancelling === order.id} onClick={() => cancel(order.id)}>{cancelling === order.id ? 'Cancelling…' : 'Cancel'}</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No orders found" detail="Orders you place will show up here." />}</article></>;
}

function Toast({ toast, close }) { if (!toast) return null; return <div className={`toast ${toast.tone}`}><span>{toast.tone === 'success' ? <Check size={18} /> : <X size={18} />}</span>{toast.text}<button aria-label="Dismiss message" onClick={close}><X size={16} /></button></div>; }

function App() {
  const [path, navigate] = usePath();
  const [theme, setTheme] = useState(() => localStorage.getItem('stockey-theme') ?? 'dark');
  const [user, setUser] = useState(null); const [accessToken, setAccessToken] = useState(null); const [authLoading, setAuthLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL'); const [stocks, setStocks] = useState(fallbackStocks); const [toast, setToast] = useState(null);
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  const showToast = (text, tone = 'success') => { setToast({ text, tone }); window.setTimeout(() => setToast(null), 4500); };
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('stockey-theme', theme); }, [theme]);
  useEffect(() => { (async () => { try { const response = await fetch(`${api}/api/users/me`, { credentials: 'include' }); if (response.ok) { const data = await response.json(); setUser(data.user); if (path === '/login' || path === '/auth/callback') navigate('/'); } else if (path === '/auth/callback') showToast('Sign-in could not be completed.', 'error'); } finally { setAuthLoading(false); } })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const request = async (endpoint, options = {}) => fetch(`${api}${endpoint}`, { credentials: 'include', ...options, headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(options.headers ?? {}) } });
  const onAuthenticated = (nextUser, token) => { setUser(nextUser); setAccessToken(token); navigate('/'); };
  const logout = async () => { await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); setAccessToken(null); navigate('/login'); };
  if (authLoading) return <div className="app-loader"><Brand /><span>Preparing your market workspace…</span></div>;
  if (!user) return <><Login onAuthenticated={onAuthenticated} theme={theme} toggleTheme={toggleTheme} /><Toast toast={toast} close={() => setToast(null)} /></>;
  const view = path === '/portfolio' ? <Portfolio request={request} showToast={showToast} setSelectedSymbol={setSelectedSymbol} navigate={navigate} /> : path === '/orders' ? <Orders request={request} showToast={showToast} /> : <Dashboard request={request} theme={theme} selectedSymbol={selectedSymbol} setSelectedSymbol={setSelectedSymbol} stocks={stocks} setStocks={setStocks} showToast={showToast} />;
  return <><AppShell path={path} navigate={navigate} theme={theme} toggleTheme={toggleTheme} user={user} onLogout={logout}>{view}</AppShell><Toast toast={toast} close={() => setToast(null)} /></>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
