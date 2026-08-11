// Routes: User
// Purpose: expose user-related endpoints for profile, portfolio, and trade
// history. Routes handle only wiring and middleware; business logic lives
// in the controller.
import { Router } from 'express';
import { getCurrentUser, getPortfolio, getTradeHistory } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/authenticate.js';

export const userRouter = Router();

// All user routes require a valid access token.

// Get the authenticated user's profile (id, email, balance, etc.)
userRouter.get('/me', requireAuth, getCurrentUser);

// ── Portfolio endpoints (Phase 5) ─────────────────────────────────────────
//
// GET /api/users/portfolio
//   Returns all current holdings enriched with last-traded price and
//   unrealised P&L. Used by both the frontend dashboard and the daily
//   P&L email summary job.
userRouter.get('/portfolio', requireAuth, getPortfolio);

// GET /api/users/portfolio/history
//   Returns the user's personal trade history (all fills where they were
//   buyer or seller), most recent first. Used by the "My Trades" tab in
//   the Phase 6 frontend.
userRouter.get('/portfolio/history', requireAuth, getTradeHistory);

