// Rate limiter for authentication endpoints
// Purpose: protect authentication routes from brute-force and abuse.
// The production limit is intentionally low; tests and local development
// use a much higher limit to avoid flakiness during CI.
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.NODE_ENV === 'production' ? 20 : 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'TOO_MANY_AUTH_ATTEMPTS' }
});

// General-purpose limiter for unauthenticated public endpoints (order book,
// trade tape, stock list). Prevents cheap Redis/DB amplification.
export const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.NODE_ENV === 'production' ? 120 : 5000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'TOO_MANY_REQUESTS' }
});
