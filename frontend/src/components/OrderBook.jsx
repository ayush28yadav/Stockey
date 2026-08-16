import { Badge, EmptyState } from './IconButton.jsx';
import { money, compactNumber } from '../utils/constants.js';

export function OrderBook({ book, spread, loading }) {
  const side = (title, entries, tone) => <div className={`book-side ${tone}`}>
    <div className="book-label">
      <span>{title}</span>
      <span>Price</span>
      <span>Qty</span>
    </div>
    {entries.length ? entries.slice(0, 5).map((order) => (
      <div className="book-row" key={order.id}>
        <i style={{ width: `${Math.min(100, Math.max(18, Number(order.remaining) / 10))}%` }} />
        <strong>{money(order.price)}</strong>
        <span>{compactNumber(order.remaining)}</span>
      </div>
    )) : <p className="book-empty">No {title.toLowerCase()} available</p>}
  </div>;

  return <article className="terminal-panel depth-panel">
    <header className="panel-title">
      <strong>Market depth</strong>
      <Badge tone="success">Live</Badge>
    </header>
    {loading ? (
      <EmptyState title="Loading depth" detail="Fetching order book" />
    ) : (
      <div className="book-content">
        {side('Asks', book.asks, 'asks')}
        <div className="spread-row">
          <span>Spread</span>
          <strong>{spread === null ? '—' : money(spread)}</strong>
        </div>
        {side('Bids', book.bids, 'bids')}
      </div>
    )}
  </article>;
}
