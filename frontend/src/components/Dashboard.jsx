import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Activity, CandlestickChart, ChevronDown, Crosshair,
  Grid2X2, LineChart, MoreHorizontal, Plus, Settings2,
  SlidersHorizontal, TrendingDown, TrendingUp
} from 'lucide-react';
import { PriceChart } from './PriceChart.jsx';
import { OrderBook } from './OrderBook.jsx';
import { TradeTape } from './TradeTape.jsx';
import { api, fallbackStocks, makeKey, money, percent, time } from '../utils/constants.js';

function InstrumentHeader({ selectedSymbol, selectedStock, displayedPrice }) {
  return <header className="instrument-header">
    <span className="instrument-logo">{selectedSymbol.slice(0, 1)}</span>
    <strong>{selectedSymbol}</strong>
    <span className="instrument-price">{money(displayedPrice)}</span>
    <span className={selectedStock.change >= 0 ? 'quote-up' : 'quote-down'}>
      {selectedStock.change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {percent(selectedStock.change)}
    </span>
    <MoreHorizontal size={18} className="header-more" />
  </header>;
}

function ChartToolbar({ chartType, onChartTypeChange, showToast }) {
  return <div className="chart-toolbar">
    <button type="button" onClick={() => showToast('Drawing tools coming soon', 'success')}><Plus size={16} /></button>
    <button type="button" className="timeframe">D</button>
    <span className="toolbar-rule" />
    <button type="button" aria-label="Candlestick" className={chartType === 'candlestick' ? 'active' : ''} onClick={() => onChartTypeChange('candlestick')}><CandlestickChart size={17} /></button>
    <button type="button" aria-label="Line" className={chartType === 'line' ? 'active' : ''} onClick={() => onChartTypeChange('line')}><LineChart size={17} /></button>
    <button type="button" className="toolbar-text">Indicators</button>
    <button type="button" onClick={() => showToast('Layout options coming soon', 'success')}><Grid2X2 size={16} /></button>
    <span className="toolbar-space" />
    <button type="button" onClick={() => showToast('Crosshair mode toggled', 'success')}><Crosshair size={17} /></button>
    <button type="button" onClick={() => showToast('Chart settings coming soon', 'success')}><Settings2 size={17} /></button>
    <button type="button" onClick={() => showToast('More options coming soon', 'success')}><MoreHorizontal size={17} /></button>
  </div>;
}

function ChartStage({ trades, price, theme, chartType, timeframe, selectedSymbol, showToast }) {
  const [activeTool, setActiveTool] = useState('crosshair');
  return <div className="chart-stage">
    <div className="drawing-rail">
      <button type="button" className={activeTool === 'crosshair' ? 'active' : ''} title="Crosshairs" onClick={() => { setActiveTool('crosshair'); showToast?.('Crosshairs tool active', 'success'); }}><Crosshair size={17} /></button>
      <button type="button" className={activeTool === 'line' ? 'active' : ''} title="Trend Line" onClick={() => { setActiveTool('line'); showToast?.('Trend Line tool selected', 'success'); }}><LineChart size={17} /></button>
      <button type="button" className={activeTool === 'sliders' ? 'active' : ''} title="Adjust Scale" onClick={() => { setActiveTool('sliders'); showToast?.('Scale settings active', 'success'); }}><SlidersHorizontal size={17} /></button>
      <button type="button" className={activeTool === 'activity' ? 'active' : ''} title="Technical Indicators" onClick={() => { setActiveTool('activity'); showToast?.('Indicators panel active', 'success'); }}><ActivityIcon size={17} /></button>
    </div>
    <PriceChart trades={trades} price={price} theme={theme} chartType={chartType} timeframe={timeframe} selectedSymbol={selectedSymbol} />
  </div>;
}

function ActivityIcon(props) { return <Activity {...props} />; }

function TerminalChartFooter({ connected, trades, timeframe, onTimeframeChange }) {
  const timeframes = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'All'];
  return <footer className="terminal-chart-footer">
    <div>
      {timeframes.map((tf) => (
        <button key={tf} type="button" className={timeframe === tf ? 'active' : ''} onClick={() => onTimeframeChange(tf)}>
          {tf}
        </button>
      ))}
    </div>
    <span>
      <i className={connected ? 'live-dot' : 'offline-dot'} />
      {connected ? 'Live' : 'Reconnecting'} · {trades[0] ? time(trades[0].created_at) : 'Waiting for market data'}
    </span>
  </footer>;
}

function Watchlist({ stocks, selectedSymbol, onSelectSymbol }) {
  return <article className="terminal-panel watchlist-panel">
    <header className="panel-title">
      <strong>All Watchlist</strong>
      <ChevronDown size={15} /><span />
      <Plus size={17} />
      <MoreHorizontal size={18} />
    </header>
    <div className="watchlist">
      {stocks.map((stock, index) => (
        <button
          key={stock.symbol}
          type="button"
          onClick={() => onSelectSymbol(stock.symbol)}
          className={stock.symbol === selectedSymbol ? 'selected' : ''}
        >
          <span className={`watch-icon icon-${index}`}>{stock.symbol.slice(0, 1)}</span>
          <span className="watch-name">
            <strong>{stock.symbol}</strong>
            <small>NSE</small>
          </span>
          <span className={(stock.change ?? 0) >= 0 ? 'spark up' : 'spark down'}>⌁⌁⌁⌁</span>
          <span className="watch-price">
            {money(stock.lastPrice)}
            <small className={(stock.change ?? 0) >= 0 ? 'quote-up' : 'quote-down'}>
              {percent(stock.change)}
            </small>
          </span>
        </button>
      ))}
    </div>
  </article>;
}

function TradeTicket({ selectedSymbol, selectedStock, displayedPrice, side, setSide, orderType, setOrderType, price, setPrice, quantity, setQuantity, placing, onPlaceOrder }) {
  return <article className="terminal-panel trade-ticket">
    <header className="panel-title"><strong>Trade</strong><MoreHorizontal size={19} /></header>
    <div className="ticket-instrument">
      <span className="instrument-logo">{selectedSymbol.slice(0, 1)}</span>
      <strong>{selectedSymbol}</strong>
      <span>{money(displayedPrice)}</span>
      <small className={selectedStock.change >= 0 ? 'quote-up' : 'quote-down'}>{percent(selectedStock.change)}</small>
    </div>
    <form onSubmit={onPlaceOrder}>
      <div className="ticket-toggle">
        <button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>Buy</button>
        <button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>Sell</button>
      </div>
      <label className="ticket-field">
        <span>Type</span>
        <select value={orderType} onChange={(event) => setOrderType(event.target.value)}>
          <option value="limit">Limit Order</option>
          <option value="market">Market Order</option>
        </select>
      </label>
      {orderType === 'limit' && (
        <label className="ticket-field">
          <span>Order limit</span>
          <div className="stepper">
            <button type="button" onClick={() => setPrice(String(Math.max(0, Number(price || displayedPrice) - .01).toFixed(2)))}>−</button>
            <input min="0.01" step="0.01" type="number" placeholder={displayedPrice?.toFixed(2)} value={price} onChange={(event) => setPrice(event.target.value)} />
            <button type="button" onClick={() => setPrice(String((Number(price || displayedPrice) + .01).toFixed(2)))}>+</button>
          </div>
        </label>
      )}
      <label className="ticket-field">
        <span>Shares</span>
        <div className="stepper">
          <button type="button" onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>−</button>
          <input min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <button type="button" onClick={() => setQuantity(String(Number(quantity) + 1))}>+</button>
        </div>
      </label>
      <label className="ticket-field">
        <span>Expiry</span>
        <select><option>Good for Day</option></select>
      </label>
      <div className="ticket-total">
        <span>Order total</span>
        <strong>{money((orderType === 'limit' ? Number(price) : displayedPrice) * Number(quantity || 0))}</strong>
      </div>
      <div className="allocation">
        <div><i /><i /><i /><i /></div>
        <span>Bid <b>70%</b></span>
        <span>Ask <b>30%</b></span>
      </div>
      <button className={`ticket-submit ${side}`} disabled={placing}>
        {placing ? 'Placing order…' : side === 'buy' ? `Buy ${selectedSymbol}` : `Sell ${selectedSymbol}`}
      </button>
      <p className="ticket-note">Simulated exchange · no real money</p>
    </form>
  </article>;
}

function MarketTicker({ stocks, onSelectSymbol }) {
  return <footer className="market-ticker">
    {stocks.map((stock) => (
      <button key={stock.symbol} type="button" onClick={() => onSelectSymbol(stock.symbol)}>
        <b>{stock.symbol}</b> {money(stock.lastPrice)}{' '}
        <em className={(stock.change ?? 0) >= 0 ? 'quote-up' : 'quote-down'}>{percent(stock.change)}</em>
      </button>
    ))}
    <span><ActivityIcon size={15} />{time(new Date())}</span>
  </footer>;
}

export function Dashboard({ request, theme, selectedSymbol, setSelectedSymbol, stocks, setStocks, showToast }) {
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
  const [timeframe, setTimeframe] = useState('1D');
  const [chartType, setChartType] = useState('candlestick');

  const selectedStock = useMemo(() => stocks.find((stock) => stock.symbol === selectedSymbol) ?? fallbackStocks[0], [stocks, selectedSymbol]);
  const displayedPrice = useMemo(() => lastPrice || selectedStock.lastPrice || 0, [lastPrice, selectedStock.lastPrice]);

  const loadMarket = useCallback(async () => {
    setLoading(true);
    try {
      const [bookResponse, tradeResponse, stockResponse] = await Promise.all([
        request(`/api/orderbook/${selectedSymbol}`),
        request(`/api/trades/${selectedSymbol}`),
        request('/api/stocks')
      ]);
      if (bookResponse.ok) {
        const data = await bookResponse.json();
        setBook({ bids: data.bids ?? [], asks: data.asks ?? [] });
      }
      if (tradeResponse.ok) {
        const data = await tradeResponse.json();
        setTrades(data.trades ?? []);
        if (data.trades?.[0]?.price) setLastPrice(Number(data.trades[0].price));
      }
      if (stockResponse.ok) {
        const data = await stockResponse.json();
        if (data.stocks?.length) {
          const apiMap = new Map(data.stocks.map((s) => [s.symbol, s]));
          setStocks(fallbackStocks.map((fb) => {
            const apiStock = apiMap.get(fb.symbol);
            return { ...fb, ...apiStock, lastPrice: apiStock?.lastPrice ?? fb.lastPrice, change: apiStock?.change ?? fb.change, updatedAt: apiStock?.updatedAt };
          }));
        }
      }
    } catch {
      showToast('Market data is temporarily unavailable. Showing the last known view.', 'error');
    } finally {
      setLoading(false);
    }
  }, [request, selectedSymbol, showToast, setStocks]);

  const loadMarketRef = useRef(loadMarket);
  loadMarketRef.current = loadMarket;

  useEffect(() => {
    loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    const socket = io(api, { query: { symbol: selectedSymbol }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('orderbook:update', (payload) => {
      if (payload.price) {
        const tradePrice = Number(payload.price);
        const trade = {
          id: `${payload.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          price: tradePrice,
          quantity: payload.executedQuantity || payload.quantity || 10,
          side: payload.side || 'buy',
          created_at: payload.timestamp || new Date().toISOString()
        };
        setLastPrice(tradePrice);
        setTrades((current) => [trade, ...current].slice(0, 50));
      }
      if (payload.bids && payload.asks) {
        setBook({ bids: payload.bids, asks: payload.asks });
      }
    });
    return () => {
      socket.disconnect();
      socket.removeAllListeners();
    };
  }, [selectedSymbol]);

  const placeOrder = useCallback(async (event) => {
    event.preventDefault();
    if (!Number(quantity) || (orderType === 'limit' && !Number(price))) return showToast('Enter a valid quantity and limit price.', 'error');
    setPlacing(true);
    try {
      const response = await request('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': makeKey() },
        body: JSON.stringify({
          stockSymbol: selectedSymbol,
          side,
          orderType,
          quantity: Number(quantity),
          ...(orderType === 'limit' ? { price: Number(price) } : {})
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Order could not be placed.');
      showToast(`${side === 'buy' ? 'Buy' : 'Sell'} order submitted for ${selectedSymbol}.`, 'success');
      setPrice('');
      loadMarket();
    } catch (caught) {
      showToast(caught.message, 'error');
    } finally {
      setPlacing(false);
    }
  }, [request, selectedSymbol, side, orderType, quantity, price, showToast, loadMarket]);

  const spread = useMemo(() => {
    return book.asks[0] && book.bids[0] ? Number(book.asks[0].price) - Number(book.bids[0].price) : null;
  }, [book]);

  return <section className="terminal-dashboard">
    <article className="terminal-panel terminal-chart-panel">
      <InstrumentHeader selectedSymbol={selectedSymbol} selectedStock={selectedStock} displayedPrice={displayedPrice} />
      <ChartToolbar chartType={chartType} onChartTypeChange={setChartType} showToast={showToast} />
      <ChartStage trades={trades} price={displayedPrice} theme={theme} chartType={chartType} timeframe={timeframe} selectedSymbol={selectedSymbol} showToast={showToast} />
      <TerminalChartFooter connected={connected} trades={trades} timeframe={timeframe} onTimeframeChange={setTimeframe} />
    </article>
    <section className="terminal-middle-column">
      <TradeTape trades={trades} loading={loading} />
      <OrderBook book={book} spread={spread} loading={loading} />
      <Watchlist stocks={stocks} selectedSymbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} />
    </section>
    <TradeTicket
      selectedSymbol={selectedSymbol}
      selectedStock={selectedStock}
      displayedPrice={displayedPrice}
      side={side}
      setSide={setSide}
      orderType={orderType}
      setOrderType={setOrderType}
      price={price}
      setPrice={setPrice}
      quantity={quantity}
      setQuantity={setQuantity}
      placing={placing}
      onPlaceOrder={placeOrder}
    />
    <MarketTicker stocks={stocks} onSelectSymbol={setSelectedSymbol} />
  </section>;
}
