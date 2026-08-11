// Routes: Authentication
// Purpose: expose authentication endpoints for registration, login,
// OAuth, token rotation, logout, and OTP verification. The routes are
// kept minimal and delegate all validation & business logic to the
// corresponding controller functions.
import { Router } from 'express';
import { authLimiter } from '../rate-limit.js';
import {
    completeGoogleOAuth,
    login,
    logout,
    refreshSession,
    register,
    startGoogleOAuth,
    sendOtp,    // Phase 5: OTP send
    verifyOtp   // Phase 5: OTP verify
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/authenticate.js';

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

// ── OTP endpoints (Phase 5) ────────────────────────────────────────────────
//
// Both OTP routes require authentication because the OTP is scoped to the
// authenticated user's ID and email. An unauthenticated caller cannot
// determine which user's OTP they are requesting or verifying.
//
// Typical flow:
//   1. User is logged in and wants to perform a sensitive action (e.g. withdraw).
//   2. Frontend calls POST /api/auth/otp/send with { action: "withdraw funds" }.
//   3. Server stores OTP in Redis and sends it to the user's email (async).
//   4. User reads OTP from email and submits it.
//   5. Frontend calls POST /api/auth/otp/verify with { otp: "123456" }.
//   6. Server verifies the OTP and returns { success: true }.
//   7. Frontend proceeds with the sensitive action, including the verification
//      result as proof of OTP completion.

// Send a 6-digit OTP to the authenticated user's email address.
// Body: { action?: string } — human-readable name for the protected action.
authRouter.post('/otp/send', requireAuth, authLimiter, sendOtp);

// Verify a submitted OTP code.
// Body: { otp: string } — the 6-digit code the user received by email.
authRouter.post('/otp/verify', requireAuth, authLimiter, verifyOtp);

