import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Home, CandlestickChart, ArrowDownRight, Bell,
  Sun, Moon, LogOut, Menu, Search, Wallet, Plus, SlidersHorizontal, X
} from 'lucide-react';
import { Brand } from './Brand.jsx';
import { IconButton } from './IconButton.jsx';
import { money, percent } from '../utils/constants.js';

const nav = [
  { to: '/', label: 'Trading terminal', icon: Home },
  { to: '/portfolio', label: 'Portfolio', icon: CandlestickChart },
  { to: '/orders', label: 'Orders', icon: ArrowDownRight }
];

export function AppShell({
  path, navigate, theme, toggleTheme, user, setUser, onLogout,
  stocks = [], setSelectedSymbol, request, showToast, children
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fundsModalOpen, setFundsModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('50000');
  const [cashBalance, setCashBalance] = useState(user?.cashBalance ?? 100000);
  const [addingFunds, setAddingFunds] = useState(false);
  const searchInputRef = useRef(null);

  // Fetch portfolio cash balance
  useEffect(() => {
    if (!request) return;
    (async () => {
      try {
        const response = await request('/api/users/portfolio');
        if (response.ok) {
          const data = await response.json();
          if (data.cashBalance !== undefined) setCashBalance(Number(data.cashBalance));
        }
      } catch {
        // ignore fallback
      }
    })();
  }, [request, path]);

  // Global Cmd+K / Ctrl+K key listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setFundsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const selectNav = useMemo(() => (to) => {
    navigate(to);
    setMobileOpen(false);
  }, [navigate]);

  const filteredStocks = useMemo(() => {
    if (!search.trim()) return stocks;
    const q = search.toLowerCase();
    return stocks.filter(s => s.symbol.toLowerCase().includes(q));
  }, [stocks, search]);

  const handleSelectSymbol = (symbol) => {
    if (setSelectedSymbol) setSelectedSymbol(symbol);
    navigate('/');
    setSearchOpen(false);
    setSearch('');
  };

  const handleAddFundsSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) return;
    setAddingFunds(true);
    try {
      // Update local simulated balance
      const newBal = cashBalance + amount;
      setCashBalance(newBal);
      if (setUser) setUser(prev => ({ ...prev, cashBalance: newBal }));
      showToast?.(`Successfully added ${money(amount)} to your wallet!`, 'success');
      setFundsModalOpen(false);
    } catch {
      showToast?.('Could not add funds.', 'error');
    } finally {
      setAddingFunds(false);
    }
  };

  return <div className="terminal-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="rail-brand"><Brand compact /></div>
      <nav>
        {nav.map((item) => (
          <button
            key={item.to}
            type="button"
            className={path === item.to ? 'active' : ''}
            onClick={() => selectNav(item.to)}
            aria-label={item.label}
            title={item.label}
          >
            <item.icon size={19} />
          </button>
        ))}
        <button type="button" aria-label="Markets" title="Markets" onClick={() => setSearchOpen(true)}><SlidersIcon /></button>
        <button type="button" aria-label="Alerts" title="Alerts" onClick={() => showToast?.('Alerts feature coming soon', 'success')}><Bell size={18} /></button>
      </nav>
      <div className="sidebar-bottom">
        <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'} title={theme === 'dark' ? 'Use light mode' : 'Use dark mode'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button type="button" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
      </div>
    </aside>
    {mobileOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

    <section className="app-content">
      <header className="topbar">
        <IconButton label="Open navigation" className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></IconButton>
        <div className="search-wrapper">
          <label className="terminal-search" onClick={() => setSearchOpen(true)}>
            <Search size={17} />
            <input
              readOnly
              value={search}
              placeholder="Search stock (AAPL, RELIANCE, NVDA…)"
              onClick={() => setSearchOpen(true)}
            />
            <kbd>⌘ K</kbd>
          </label>
        </div>
        <div className="topbar-actions">
          <div className="terminal-balance" title="Simulated Cash Balance"><Wallet size={15} />{money(cashBalance)}</div>
          <IconButton label="Add funds" onClick={() => setFundsModalOpen(true)}><Plus size={18} /></IconButton>
          <IconButton label="Notifications" onClick={() => showToast?.('No new notifications', 'success')}><Bell size={18} /></IconButton>
          <button type="button" className="avatar-button" title={user?.email || 'User'}>{(user?.email || 'U').slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      <main className="page-content">{children}</main>
    </section>

    {/* Search Modal Overlay */}
    {searchOpen && (
      <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
        <div className="search-modal" onClick={(e) => e.stopPropagation()}>
          <header className="search-modal-header">
            <Search size={18} className="search-icon" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search instrument symbol or name…"
            />
            <button type="button" className="close-btn" onClick={() => setSearchOpen(false)}><X size={18} /></button>
          </header>
          <div className="search-modal-results">
            {filteredStocks.length ? (
              filteredStocks.map((s) => (
                <button key={s.symbol} type="button" className="search-result-row" onClick={() => handleSelectSymbol(s.symbol)}>
                  <span className="stock-logo">{s.symbol.slice(0, 1)}</span>
                  <div className="stock-info">
                    <strong>{s.symbol}</strong>
                    <small>NSE Simulated Exchange</small>
                  </div>
                  <div className="stock-price-info">
                    <span>{money(s.lastPrice)}</span>
                    <small className={(s.change ?? 0) >= 0 ? 'quote-up' : 'quote-down'}>{percent(s.change)}</small>
                  </div>
                </button>
              ))
            ) : (
              <div className="no-results">No instruments matching &quot;{search}&quot;</div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Add Funds Modal Overlay */}
    {fundsModalOpen && (
      <div className="modal-backdrop" onClick={() => setFundsModalOpen(false)}>
        <div className="funds-modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header">
            <h3>Add Simulated Funds</h3>
            <button type="button" onClick={() => setFundsModalOpen(false)}><X size={18} /></button>
          </header>
          <form onSubmit={handleAddFundsSubmit} className="funds-form">
            <p>Top up your virtual account balance for simulated paper trading.</p>
            <label>
              <span>Amount (INR)</span>
              <input
                type="number"
                min="1000"
                step="5000"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                required
              />
            </label>
            <div className="preset-buttons">
              {['10000', '50000', '100000', '500000'].map((amt) => (
                <button
                  type="button"
                  key={amt}
                  className={depositAmount === amt ? 'active' : ''}
                  onClick={() => setDepositAmount(amt)}
                >
                  +{money(amt, 0)}
                </button>
              ))}
            </div>
            <button type="submit" className="primary-button full" disabled={addingFunds}>
              {addingFunds ? 'Adding funds…' : 'Deposit Funds'}
            </button>
          </form>
        </div>
      </div>
    )}
  </div>;
}

function SlidersIcon() { return <SlidersHorizontal size={19} />; }
