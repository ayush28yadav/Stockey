// Unit tests for realtime API code and Socket.IO attachment.
// Purpose: verify the order book snapshot and trade tape controller logic,
// and ensure the realtime socket layer accepts the correct symbol query.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://localhost/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.API_ORIGIN = 'http://localhost:4000';
process.env.SESSION_SECRET = '01234567890123456789012345678901';
process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from('private').toString('base64');
process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from('public').toString('base64');

import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { io } from 'socket.io-client';

const realtimeController = await import('../src/controllers/realtime.controller.js');
const socketModule = await import('../src/socket.js');
const redisApi = await import('../src/redis.js');

function createResponse() {
  let body = null;
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    get body() {
      return body;
    }
  };
  return response;
}

test('getOrderBookSnapshot returns reconciled Redis book data', async () => {
  const req = { params: { symbol: 'AAPL' } };
  const res = createResponse();
  const next = (error) => { if (error) throw error; };

  redisApi.redisClient.zRange = async (key, start, stop) => {
    if (key.startsWith('BIDS:'))
      return ['100:bid-order'];
    if (key.startsWith('ASKS:'))
      return ['200:ask-order'];
    return [];
  };

  redisApi.redisClient.hGetAll = async (key) => {
    if (key === 'ORDER:bid-order')
      return { id: 'bid-order', symbol: 'AAPL', price: '150.00', remaining: '5', status: 'open', userId: 'user-1' };
    if (key === 'ORDER:ask-order')
      return { id: 'ask-order', symbol: 'AAPL', price: '151.00', remaining: '3', status: 'open', userId: 'user-2' };
    return {};
  };

  await realtimeController.getOrderBookSnapshot(req, res, next);

  assert.equal(res.body.symbol, 'AAPL');
  assert.equal(res.body.bids.length, 1);
  assert.equal(res.body.asks.length, 1);
  assert.equal(res.body.bids[0].price, 150.00);
  assert.equal(res.body.asks[0].price, 151.00);
  assert.equal(res.body.bids[0].remaining, 5);
});

test('getTradeTape queries the trades table with executed_at alias', async () => {
  const req = { params: { symbol: 'AAPL' } };
  const res = createResponse();
  const next = (error) => { if (error) throw error; };

  let sawQuery = false;
  realtimeController.pool.query = async (query, params) => {
    assert.equal(params[0], 'AAPL');
    assert.match(query, /executed_at AS created_at/);
    sawQuery = true;
    return {
      rows: [{ id: 'trade-1', buy_order_id: 'b1', sell_order_id: 's1', stock_symbol: 'AAPL', price: '100.00', quantity: 2, created_at: '2026-01-01T00:00:00Z' }]
    };
  };

  await realtimeController.getTradeTape(req, res, next);

  assert.ok(sawQuery, 'Expected controller to execute a trades query');
  assert.equal(res.body.symbol, 'AAPL');
  assert.equal(res.body.trades.length, 1);
  assert.equal(res.body.trades[0].price, '100.00');
});

test('attachSocketServer allows symbol-scoped websocket connections', async () => {
  const originalSubscribe = redisApi.subClient.pSubscribe;
  redisApi.subClient.pSubscribe = async () => undefined;

  const server = http.createServer();
  const ioServer = socketModule.attachSocketServer(server, '*');

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const client = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    query: { symbol: 'AAPL' },
    reconnection: false,
    timeout: 2000
  });

  try {
    await once(client, 'connect');
  }
  finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
    redisApi.subClient.pSubscribe = originalSubscribe;
  }
});

test('attachSocketServer disconnects websocket connections without symbol query', async () => {
  const originalSubscribe = redisApi.subClient.pSubscribe;
  redisApi.subClient.pSubscribe = async () => undefined;

  const server = http.createServer();
  const ioServer = socketModule.attachSocketServer(server, '*');

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const client = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000
  });

  try {
    const connectPromise = once(client, 'connect').then(() => 'connect');
    const disconnectPromise = once(client, 'disconnect').then(() => 'disconnect');
    const errorPromise = once(client, 'connect_error').then(() => 'connect_error');

    const event = await Promise.race([
      connectPromise,
      disconnectPromise,
      errorPromise,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000))
    ]);

    if (event === 'connect') {
      await Promise.race([
        disconnectPromise,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000))
      ]);
    }

    assert.equal(client.connected, false, 'Socket should be disconnected without a symbol query');
  }
  finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
    redisApi.subClient.pSubscribe = originalSubscribe;
  }
});
