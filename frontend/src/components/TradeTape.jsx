import { useMemo } from 'react';
import { EmptyState } from './IconButton.jsx';
import { CircleDollarSign, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { compactNumber, money, time } from '../utils/constants.js';

export function TradeTape({ trades = [], loading }) {
  const stats = useMemo(() => {
    if (!trades.length) return { open: null, high: null, low: null, volume: 0 };
    const prices = trades.map(t => Number(t.price)).filter(Number.isFinite);
    const volume = trades.reduce((acc, t) => acc + (Number(t.quantity) || 0), 0);
    return {
      open: prices[prices.length - 1] ?? null,
      high: prices.length ? Math.max(...prices) : null,
      low: prices.length ? Math.min(...prices) : null,
      volume
    };
  }, [trades]);

  return <article className="terminal-panel tape-card">
    <header className="panel-title">
      <strong>Running trade</strong>
      <span />
      <CircleDollarIcon size={17} />
      <SlidersIcon size={17} />
      <MoreIcon size={18} />
    </header>
    <div className="quote-stats">
      <span>Open<b>{stats.open ? money(stats.open) : '—'}</b></span>
      <span>High<b>{stats.high ? money(stats.high) : '—'}</b></span>
      <span>Low<b>{stats.low ? money(stats.low) : '—'}</b></span>
      <span>Vol<b>{compactNumber(stats.volume)}</b></span>
    </div>
    {loading ? (
      <EmptyState title="Loading trades" detail="Fetching executions" />
    ) : trades.length ? (
      <div className="tape-list">
        <div className="tape-columns">
          <span>Time</span>
          <span>Price</span>
          <span>Action</span>
          <span>Volume</span>
        </div>
        {trades.slice(0, 9).map((trade, index) => {
          const prevTrade = trades[index + 1];
          const isUp = trade.side === 'buy' || (prevTrade ? Number(trade.price) >= Number(prevTrade.price) : true);
          const isSell = trade.side === 'sell' || (!isUp && trade.side !== 'buy');
          return (
            <div className="tape-row" key={trade.id || index}>
              <time>{time(trade.created_at || trade.executedAt)}</time>
              <strong className={isSell ? 'quote-down' : 'quote-up'}>{money(trade.price)}</strong>
              <span className={isSell ? 'quote-down' : 'quote-up'}>
                {isSell ? 'Sell' : 'Buy'}
              </span>
              <b>{compactNumber(Number(trade.quantity || 1))}</b>
            </div>
          );
        })}
      </div>
    ) : (
      <EmptyState title="No executions yet" detail="Live prints appear here." />
    )}
  </article>;
}

function CircleDollarIcon(props) { return <CircleDollarSign {...props} />; }
function SlidersIcon(props) { return <SlidersHorizontal {...props} />; }
function MoreIcon(props) { return <MoreHorizontal {...props} />; }
