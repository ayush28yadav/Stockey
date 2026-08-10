// Integration tests: authentication and orders
// Purpose: verify registration/login flows, session issuance and order
// submission idempotency. These tests are designed for a running API
// instance (for example via `docker compose up`).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { pool } from '../src/db.js';

const apiOrigin = process.env.API_BASE_URL ?? 'http://localhost:4000';
const email = `integration-${randomUUID()}@example.test`;
const password = 'integration-test-password';
let accessToken = '';
let refreshCookie = '';

function jsonRequest(path, init = {}) {
  return fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

function cookiesFrom(response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

before(async () => {
  const health = await fetch(`${apiOrigin}/health`);
  assert.equal(health.status, 200, `API is unavailable at ${apiOrigin}. Start it with docker compose up first.`);
});

after(async () => {
  await pool.query('DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
  await pool.query('DELETE FROM users WHERE email = $1', [email]);
  await pool.end();
});

test('registers an email/password user and issues an access + refresh session', async () => {
  const response = await jsonRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.user.email, email);
  assert.equal(body.expiresIn, 900);
  assert.ok(body.accessToken.length > 100);
  accessToken = body.accessToken;
  refreshCookie = cookiesFrom(response);
  assert.match(refreshCookie, /refresh_token=/);
});

test('logs in, refreshes a session, and rejects a bad password', async () => {
  const rejected = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'not-the-right-password' })
  });
  assert.equal(rejected.status, 401);

  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  assert.equal(login.status, 200);

  const loginBody = await login.json();
  accessToken = loginBody.accessToken;
  refreshCookie = cookiesFrom(login);

  const refresh = await jsonRequest('/api/auth/refresh', {
    method: 'POST',
    headers: { cookie: refreshCookie }
  });
  assert.equal(refresh.status, 200);

  const refreshed = await refresh.json();
  assert.notEqual(refreshed.accessToken, accessToken);
  assert.equal(refreshed.expiresIn, 900);
  accessToken = refreshed.accessToken;
});

test('requires authentication and saves a limit order exactly once per idempotency key', async () => {
  const orderPayload = { stockSymbol: 'AAPL', orderType: 'limit', side: 'buy', price: 185.25, quantity: 10 };
  const idempotencyKey = randomUUID();

  const unauthenticated = await jsonRequest('/api/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
  assert.equal(unauthenticated.status, 401);

  const first = await jsonRequest('/api/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(orderPayload)
  });
  assert.equal(first.status, 201);

  const firstBody = await first.json();
  assert.equal(firstBody.order.stockSymbol, 'AAPL');
  assert.equal(firstBody.order.price, 185.25);
  assert.equal(firstBody.order.status, 'open');

  const replay = await jsonRequest('/api/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(orderPayload)
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');

  const replayBody = await replay.json();
  assert.equal(replayBody.order.id, firstBody.order.id);
});
