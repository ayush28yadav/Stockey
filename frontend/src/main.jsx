// Frontend app entry (JSX)
// Purpose: demo the real-time order book and trade tape implementation
// required by the Phase 3 whitepaper. The page loads an initial snapshot
// and subscribes to live updates via Socket.IO.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const api = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:4000';
const symbol = 'AAPL';

function App() {
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [tradeTape, setTradeTape] = useState([]);
  const [liveUpdate, setLiveUpdate] = useState(null);
  const isCallback = location.pathname === '/auth/callback';

  useEffect(() => {
    if (isCallback || location.pathname === '/') {
      fetch(`${api}/api/users/me`, { credentials: 'include' })
        .then(async (r) => r.ok ? r.json() : Promise.reject())
        .then((data) => {
          setUser(data.user);
          if (isCallback) history.replaceState({}, '', '/');
        })
        .catch(() => {
          if (isCallback) setMessage('Sign-in could not be completed. Please try again.');
        });
    }
  }, [isCallback]);

  useEffect(() => {
    const socket = io(api, { query: { symbol } });

    socket.on('connect', () => {
      console.log('Connected to order book socket for', symbol);
    });

    socket.on('orderbook:update', (payload) => {
      const trade = {
        id: payload.timestamp,
        price: payload.price,
        quantity: payload.executedQuantity,
        created_at: payload.timestamp,
        buy_order_id: payload.buyOrder?.id,
        sell_order_id: payload.sellOrder?.id
      };
      setLiveUpdate(trade);
      setTradeTape((current) => [trade, ...current].slice(0, 50));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    async function loadSnapshot() {
      try {
        const [bookResponse, tradesResponse] = await Promise.all([
          fetch(`${api}/api/orderbook/${symbol}`),
          fetch(`${api}/api/trades/${symbol}`)
        ]);
        if (bookResponse.ok) {
          const data = await bookResponse.json();
          setOrderBook({ bids: data.bids, asks: data.asks });
        }
        if (tradesResponse.ok) {
          const data = await tradesResponse.json();
          setTradeTape(data.trades);
        }
      }
      catch (error) {
        console.error('Failed to load initial snapshot:', error);
      }
    }

    loadSnapshot();
  }, []);

  return (
    <main>
      <section>
        <h1>Stockey Live Order Book</h1>
        <p>Symbol: {symbol}</p>
        <p>{liveUpdate ? `Last trade: ${liveUpdate.quantity}@${liveUpdate.price}` : 'Waiting for live updates...'}</p>
      </section>
      <section>
        <h2>Order Book Snapshot</h2>
        <div className="book-grid">
          <div>
            <h3>Bids</h3>
            <table>
              <thead>
                <tr><th>Price</th><th>Qty</th><th>Status</th></tr>
              </thead>
              <tbody>
                {orderBook.bids.map((order) => (
                  <tr key={order.id}>
                    <td>{order.price?.toFixed(2)}</td>
                    <td>{order.remaining}</td>
                    <td>{order.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Asks</h3>
            <table>
              <thead>
                <tr><th>Price</th><th>Qty</th><th>Status</th></tr>
              </thead>
              <tbody>
                {orderBook.asks.map((order) => (
                  <tr key={order.id}>
                    <td>{order.price?.toFixed(2)}</td>
                    <td>{order.remaining}</td>
                    <td>{order.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section>
        <h2>Trade Tape</h2>
        <ol>
          {tradeTape.map((trade) => (
            <li key={trade.id}>{trade.quantity} @ {Number(trade.price).toFixed(2)} at {new Date(trade.created_at).toLocaleTimeString()}</li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Authentication</h2>
        {user ? (
          <p>Signed in as {user.email}</p>
        ) : (
          <button onClick={() => location.assign(`${api}/api/auth/google`)}>Continue with Google</button>
        )}
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
