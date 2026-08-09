import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../auth/tokens.js';

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  const token = bearer ?? request.cookies?.access_token;
  if (!token) return response.status(401).json({ error: 'UNAUTHENTICATED' });
  try {
    const claims = verifyAccessToken(token);
    request.auth = { userId: claims.sub, email: claims.email };
    return next();
  } catch {
    return response.status(401).json({ error: 'UNAUTHENTICATED' });
  }
}
