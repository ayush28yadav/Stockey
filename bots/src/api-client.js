/*
    Bot Service — Stockey API Client

    Purpose:
    A thin, focused HTTP client that lets bots interact with the Stockey API
    exactly the way a real user's browser would. Bots authenticate with
    email/password, receive JWT access tokens and HTTP-only cookies, and then
    submit orders and read market data through the public REST endpoints.

    Design rationale:
    - By routing ALL trading activity through the public API (rather than
      touching PostgreSQL or Redis directly), bots automatically exercise the
      full system stack: authentication, rate limiting, idempotency, the
      matching queue, WebSocket broadcasts, and settlement. This is a core
      requirement of the whitepaper (§10.3).
    - The client maintains a lightweight cookie jar so it can participate in
      the refresh-token rotation flow. Access tokens expire after 15 minutes;
      the client transparently refreshes them via `POST /api/auth/refresh`.
    - Node 20 provides a global `fetch`, so no external HTTP dependency is
      required.

    Security notes:
    - Access tokens are sent via the `Authorization: Bearer` header.
    - Refresh tokens are opaque and only ever sent back to the API as cookies
      (never logged or stored in plaintext by this client).
*/
import { randomUUID } from 'node:crypto';

export class ApiClient {
    /**
     * @param {string} apiOrigin - Base URL of the Stockey API (e.g. http://localhost:4000).
     */
    constructor(apiOrigin) {
        this.apiOrigin = apiOrigin.replace(/\/$/, '');
        // Cookie jar: maps cookie name -> value. Captured from `Set-Cookie`
        // response headers so the client can replay them on subsequent
        // requests (required for refresh-token rotation).
        this.cookieJar = new Map();
        // The most recently issued access token (from login/register/refresh).
        this.accessToken = null;
    }

    /**
     * Core request helper. Attaches the cookie jar and JSON headers, performs
     * the fetch, and captures any `Set-Cookie` headers from the response.
     *
     * @param {string} path - API path, e.g. '/api/orders'.
     * @param {object} [options] - Fetch options.
     * @param {string} [options.method] - HTTP method (default 'GET').
     * @param {object} [options.body] - JSON body to send.
     * @param {object} [options.headers] - Extra headers.
     * @returns {Promise<Response>} The raw fetch Response.
     */
    async request(path, { method = 'GET', body, headers = {} } = {}) {
        // Serialise the cookie jar into a single `Cookie` header value.
        const cookieHeader = [...this.cookieJar.entries()]
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');

        const response = await fetch(`${this.apiOrigin}${path}`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(cookieHeader ? { cookie: cookieHeader } : {}),
                ...headers
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });

        // Capture any cookies the server wants to set (login, refresh, etc.).
        const setCookies = response.headers.getSetCookie?.() ?? [];
        for (const cookie of setCookies) {
            const [pair] = cookie.split(';');
            const separator = pair.indexOf('=');
            if (separator === -1) continue;
            const name = pair.slice(0, separator).trim();
            const value = pair.slice(separator + 1).trim();
            if (value) this.cookieJar.set(name, value);
        }

        return response;
    }

    /**
     * Register a new bot account via `POST /api/auth/register`.
     * On success, stores the issued access token and cookies.
     *
     * @param {string} email - Bot email address.
     * @param {string} password - Bot password (min 12 chars per API policy).
     * @returns {Promise<object>} The parsed session body `{ user, accessToken, expiresIn }`.
     */
    async register(email, password) {
        const response = await this.request('/api/auth/register', {
            method: 'POST',
            body: { email, password }
        });
        if (!response.ok) {
            throw new Error(`Bot registration failed (${response.status}): ${await response.text()}`);
        }
        const body = await response.json();
        this.accessToken = body.accessToken;
        return body;
    }

    /**
     * Log in an existing bot account via `POST /api/auth/login`.
     * On success, stores the issued access token and cookies.
     *
     * @param {string} email - Bot email address.
     * @param {string} password - Bot password.
     * @returns {Promise<object>} The parsed session body.
     */
    async login(email, password) {
        const response = await this.request('/api/auth/login', {
            method: 'POST',
            body: { email, password }
        });
        if (!response.ok) {
            throw new Error(`Bot login failed (${response.status}): ${await response.text()}`);
        }
        const body = await response.json();
        this.accessToken = body.accessToken;
        return body;
    }

    /**
     * Rotate the refresh token via `POST /api/auth/refresh`. The refresh
     * cookie is replayed from the jar; the API issues a fresh access token and
     * rotates the refresh token. Used when an access token expires.
     *
     * @returns {Promise<object>} The parsed session body.
     */
    async refresh() {
        const response = await this.request('/api/auth/refresh', { method: 'POST' });
        if (!response.ok) {
            throw new Error(`Bot session refresh failed (${response.status}): ${await response.text()}`);
        }
        const body = await response.json();
        this.accessToken = body.accessToken;
        return body;
    }

    /**
     * Submit an order via `POST /api/orders`. Requires a valid access token
     * and a unique idempotency key (a UUID) to prevent duplicate submissions
     * on network retries.
     *
     * @param {string} accessToken - JWT access token.
     * @param {object} order - Order payload `{ stockSymbol, orderType, side, quantity, price? }`.
     * @param {string} idempotencyKey - UUID idempotency key.
     * @returns {Promise<object>} The parsed response body `{ order }`.
     */
    async placeOrder(accessToken, order, idempotencyKey = randomUUID()) {
        const response = await this.request('/api/orders', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`,
                'idempotency-key': idempotencyKey
            },
            body: order
        });
        if (!response.ok) {
            const error = new Error(`Order submission failed (${response.status}): ${await response.text()}`);
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    /**
     * Fetch the current order book snapshot for a symbol via
     * `GET /api/orderbook/:symbol`.
     *
     * @param {string} symbol - Stock symbol (e.g. 'AAPL').
     * @returns {Promise<object>} `{ symbol, bids, asks }`.
     */
    async getOrderBook(symbol) {
        const response = await this.request(`/api/orderbook/${encodeURIComponent(symbol)}`);
        if (!response.ok) {
            throw new Error(`Order book fetch failed (${response.status}): ${await response.text()}`);
        }
        return response.json();
    }

    /**
     * Fetch the recent trade tape for a symbol via `GET /api/trades/:symbol`.
     *
     * @param {string} symbol - Stock symbol (e.g. 'AAPL').
     * @returns {Promise<object>} `{ symbol, trades }`.
     */
    async getTradeTape(symbol) {
        const response = await this.request(`/api/trades/${encodeURIComponent(symbol)}`);
        if (!response.ok) {
            throw new Error(`Trade tape fetch failed (${response.status}): ${await response.text()}`);
        }
        return response.json();
    }
}