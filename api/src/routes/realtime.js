import { Router } from 'express';
import { getOrderBookSnapshot, getStocks, getTradeTape } from '../controllers/realtime.controller.js';
import { publicLimiter } from '../rate-limit.js';

export const realtimeRouter = Router();

// Public market data is unauthenticated, so rate limit it globally.
realtimeRouter.use(publicLimiter);

// Initial order book snapshot for a given symbol.
realtimeRouter.get('/orderbook/:symbol', getOrderBookSnapshot);

// Recent trade executions for a given symbol.
realtimeRouter.get('/trades/:symbol', getTradeTape);

// Symbols with their last traded prices for the dashboard watchlist.
realtimeRouter.get('/stocks', getStocks);
