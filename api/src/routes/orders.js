// Routes: Orders
// Purpose: accept new orders from authenticated users. The route
// validates authentication and forwards order payloads to the
// controller which handles idempotency, DB persistence and queueing.
import { Router } from 'express';
import { submitOrder } from '../controllers/orders.controller.js';
import { requireAuth } from '../middleware/authenticate.js';
export const ordersRouter = Router();

// Submit a new order. Requires authentication.
ordersRouter.post('/', requireAuth, submitOrder);
