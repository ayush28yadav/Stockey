// Integration tests: realtime endpoints and Socket.IO behavior
// Purpose: verify the live order book API surface and socket connection
// acceptance for symbol-scoped realtime updates.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io } from 'socket.io-client';

const apiOrigin = process.env.API_BASE_URL ?? 'http://localhost:4000';

function jsonRequest(path, init = {}) {
  return fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

before(async () => {
  const health = await fetch(`${apiOrigin}/health`);
  assert.equal(health.status, 200, `API is unavailable at ${apiOrigin}. Start it with docker compose up first.`);
});

after(async () => {
  // No cleanup required for read-only realtime integration checks.
});

test('GET /api/orderbook/:symbol returns an order book snapshot', async () => {
  const response = await jsonRequest('/api/orderbook/AAPL');
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.symbol, 'AAPL');
  assert.ok(Array.isArray(body.bids), 'Expected bids to be an array');
  assert.ok(Array.isArray(body.asks), 'Expected asks to be an array');
});

test('GET /api/trades/:symbol returns the trade tape', async () => {
  const response = await jsonRequest('/api/trades/AAPL');
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.symbol, 'AAPL');
  assert.ok(Array.isArray(body.trades), 'Expected trades to be an array');
});

test('Socket.IO accepts connections with a symbol query', async () => {
  const client = io(apiOrigin, {
    transports: ['websocket'],
    query: { symbol: 'AAPL' },
    reconnection: false,
    timeout: 5000
  });

  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
    client.once('error', reject);
    setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
  });

  client.close();
});

test('Socket.IO rejects connections when symbol query is missing', async () => {
  const client = io(apiOrigin, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });

  const result = await new Promise((resolve) => {
    let connected = false;
    let disconnected = false;

    client.once('connect', () => {
      connected = true;
    });

    client.once('connect_error', () => resolve({ connected, disconnected: false }));
    client.once('disconnect', () => resolve({ connected, disconnected: true }));
    setTimeout(() => resolve({ connected, disconnected: false }), 5000);
  });

  client.close();
  assert.equal(result.disconnected, true, 'Expected socket connection to be rejected when no symbol is provided');
});
