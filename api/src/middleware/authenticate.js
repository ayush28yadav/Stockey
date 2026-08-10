// Authentication middleware
// Purpose: verify access tokens passed either in the `Authorization`
// header or as an `access_token` cookie. On success it attaches a
// lightweight `request.auth` object with `userId` and `email` to the
// request for downstream handlers.
import { verifyAccessToken } from '../auth/tokens.js';
export function requireAuth(request, response, next) {
    const authorization = request.get('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = bearer ?? request.cookies?.access_token;
    if (!token)
        return response.status(401).json({ error: 'UNAUTHENTICATED' });
    try {
        const claims = verifyAccessToken(token);
        request.auth = { userId: claims.sub, email: claims.email };
        return next();
    }
    catch {
        return response.status(401).json({ error: 'UNAUTHENTICATED' });
    }
}
