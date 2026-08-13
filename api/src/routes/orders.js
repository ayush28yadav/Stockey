// Routes: Orders
// Purpose: accept new orders from authenticated users. The route
// validates authentication and forwards order payloads to the
// controller which handles idempotency, DB persistence and queueing.
import { Router } from 'express';
import { cancelOrder, getOrder, listOrders, submitOrder } from '../controllers/orders.controller.js';
import { requireAuth } from '../middleware/authenticate.js';
export const ordersRouter = Router();

// Submit a new order. Requires authentication.
ordersRouter.post('/', requireAuth, submitOrder);

// The dashboard's Orders page is intentionally scoped to the authenticated
// user. It never exposes another trader's orders or idempotency keys.
ordersRouter.get('/', requireAuth, listOrders);
ordersRouter.get('/:id', requireAuth, getOrder);
ordersRouter.delete('/:id', requireAuth, cancelOrder);
