// Routes: User
// Purpose: expose user-related endpoints. Keep controllers focused on
// business logic and database access; routes only handle wiring and
// middleware (e.g. `requireAuth`).
import { Router } from 'express';
import { getCurrentUser } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/authenticate.js';
export const userRouter = Router();

// Get details for the currently authenticated user.
userRouter.get('/me', requireAuth, getCurrentUser);
