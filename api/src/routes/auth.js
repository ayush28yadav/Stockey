// Routes: Authentication
// Purpose: expose authentication endpoints for registration, login,
// OAuth, token rotation and logout. The routes are kept minimal and
// delegate validation & business logic to controller functions.
import { Router } from 'express';
import { authLimiter } from '../rate-limit.js';
import { completeGoogleOAuth, login, logout, refreshSession, register, startGoogleOAuth } from '../controllers/auth.controller.js';
export const authRouter = Router();

// Register a new user (email + password)
authRouter.post('/register', authLimiter, register);

// Login with credentials
authRouter.post('/login', authLimiter, login);

// Google OAuth start / callback
authRouter.get('/google', startGoogleOAuth);
authRouter.get('/google/callback', completeGoogleOAuth);

// Refresh access using refresh token cookie
authRouter.post('/refresh', refreshSession);

// Revoke session and clear cookies
authRouter.post('/logout', logout);
