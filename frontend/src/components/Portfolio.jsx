import { useState, useEffect } from 'react';
import { Plus, BriefcaseBusiness, TrendingUp, Activity, Wallet } from 'lucide-react';
import { Badge, EmptyState } from './IconButton.jsx';
import { money, percent } from '../utils/constants.js';

export function Portfolio({ request, showToast, setSelectedSymbol, navigate }) {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await request('/api/users/portfolio');
        if (!response.ok) throw new Error();
        setPortfolio(await response.json());
      } catch {
        showToast('Could not load your portfolio.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [request, showToast]);

  const holdings = portfolio?.holdings ?? [];
  const invested = holdings.reduce((total, holding) => total + holding.marketValue, 0);
  const totalValue = invested + Number(portfolio?.cashBalance ?? 0);

  return <>
    <section className="page-hero">
      <div>
        <div className="eyebrow">YOUR POSITIONS</div>
        <h2>Portfolio performance</h2>
        <p>Your cash balance and live holdings, all in one view.</p>
      </div>
      <button type="button" className="primary-button" onClick={() => navigate('/') }>
        <Plus size={17} />Place order
      </button>
    </section>
    <section className="metrics-grid">
      <Metric icon={<Wallet />} label="Portfolio value" value={money(totalValue)} />
      <Metric icon={<BriefcaseBusiness />} label="Invested value" value={money(invested)} />
      <Metric icon={<TrendingUp />} label="Unrealised P&L" value={money(portfolio?.totalPnl ?? 0)} tone={(portfolio?.totalPnl ?? 0) >= 0 ? 'positive' : 'negative'} />
      <Metric icon={<Activity />} label="Available cash" value={money(portfolio?.cashBalance ?? 0)} />
    </section>
    <article className="card table-card">
      <div className="card-header">
        <div>
          <p className="card-kicker">HOLDINGS</p>
          <h3>Your positions</h3>
        </div>
        <Badge>{holdings.length} assets</Badge>
      </div>
      {loading ? (
        <EmptyState title="Loading portfolio" detail="Calculating your latest position values" />
      ) : holdings.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Quantity</th>
                <th>Avg. cost</th>
                <th>Current price</th>
                <th>Market value</th>
                <th>P&L</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.stockSymbol}>
                  <td>
                    <button type="button" className="symbol-button" onClick={() => { setSelectedSymbol(holding.stockSymbol); navigate('/'); }}>
                      {holding.stockSymbol}<small>NSE</small>
                    </button>
                  </td>
                  <td>{holding.quantity}</td>
                  <td>{money(holding.avgBuyPrice)}</td>
                  <td>{money(holding.currentPrice)}</td>
                  <td>{money(holding.marketValue)}</td>
                  <td className={holding.pnl >= 0 ? 'positive' : 'negative'}>
                    <strong>{money(holding.pnl)}</strong>
                    <small>{holding.avgBuyPrice ? percent((holding.currentPrice - holding.avgBuyPrice) / holding.avgBuyPrice * 100) : '—'}</small>
                  </td>
                  <td>
                    <button type="button" className="row-action" onClick={() => { setSelectedSymbol(holding.stockSymbol); navigate('/'); }}>Trade</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Your portfolio is waiting" detail="Place your first simulated order to start building holdings." />
      )}
    </article>
  </>;
}

export function Metric({ icon, label, value, tone }) {
  return <article className="metric-card">
    <span className={`metric-icon ${tone ?? ''}`}>{icon}</span>
    <p>{label}</p>
    <strong className={tone}>{value}</strong>
  </article>;
}
