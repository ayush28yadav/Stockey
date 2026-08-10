import { Router } from 'express';
import { getOrderBookSnapshot, getTradeTape } from '../controllers/realtime.controller.js';

export const realtimeRouter = Router();

// Initial order book snapshot for a given symbol.
realtimeRouter.get('/orderbook/:symbol', getOrderBookSnapshot);

// Recent trade executions for a given symbol.
realtimeRouter.get('/trades/:symbol', getTradeTape);
