import { useState, useEffect, useCallback } from 'react';
import { Badge, EmptyState } from './IconButton.jsx';
import { dateTime, money } from '../utils/constants.js';

export function Orders({ request, showToast, setSelectedSymbol, navigate }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const response = await request(`/api/orders${query}`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      setOrders(data.orders ?? []);
    } catch {
      showToast('Could not load your order history.', 'error');
    } finally {
      setLoading(false);
    }
  }, [request, filter, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = useCallback(async (id) => {
    setCancelling(id);
    try {
      const response = await request(`/api/orders/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === 'ORDER_NOT_CANCELLABLE' ? 'This order is no longer cancellable.' : 'Could not cancel order.');
      showToast('Order cancelled.', 'success');
      load();
    } catch (caught) {
      showToast(caught.message, 'error');
    } finally {
      setCancelling(null);
    }
  }, [request, showToast, load]);

  return <>
    <section className="page-hero">
      <div>
        <div className="eyebrow">ACTIVITY</div>
        <h2>Orders</h2>
        <p>Review every submitted order and manage open positions.</p>
      </div>
      <div className="order-summary">
        <span>Open orders</span>
        <strong>{orders.filter((order) => ['open', 'partially_filled'].includes(order.status)).length}</strong>
      </div>
    </section>
    <article className="card table-card">
      <div className="card-header">
        <div>
          <p className="card-kicker">ORDER HISTORY</p>
          <h3>All orders</h3>
        </div>
        <div className="filter-group">
          {['all', 'open', 'filled', 'cancelled'].map((item) => (
            <button key={item} type="button" className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
              {item === 'all' ? 'All' : item.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <EmptyState title="Loading orders" detail="Retrieving your trading activity" />
      ) : orders.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Side</th>
                <th>Type</th>
                <th>Price</th>
                <th>Filled</th>
                <th>Status</th>
                <th>Placed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <button type="button" className="symbol-button" onClick={() => { setSelectedSymbol?.(order.stockSymbol); navigate?.('/'); }}>
                      {order.stockSymbol}<small>NSE</small>
                    </button>
                  </td>
                  <td><Badge tone={order.side === 'buy' ? 'success' : 'danger'}>{order.side}</Badge></td>
                  <td className="capitalize">{order.orderType}</td>
                  <td>{order.price === null ? 'Market' : money(order.price)}</td>
                  <td>{order.filledQuantity} / {order.quantity}</td>
                  <td>
                    <Badge tone={order.status === 'filled' ? 'success' : order.status === 'cancelled' ? 'neutral' : 'warning'}>
                      {order.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td>{dateTime(order.createdAt)}</td>
                  <td>
                    {['open', 'partially_filled'].includes(order.status) && (
                      <button type="button" className="cancel-button" disabled={cancelling === order.id} onClick={() => cancel(order.id)}>
                        {cancelling === order.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No orders found" detail="Orders you place will show up here." />
      )}
    </article>
  </>;
}
