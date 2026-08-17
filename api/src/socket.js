import { Server } from 'socket.io';
import { subClient } from './redis.js';

const CHANNEL_PREFIX = 'orderbook:';

// Mirrors the DB/API symbol constraint so arbitrary strings can never be
// used as room names or Redis channels.
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,15}$/;

// Connection safeguards. Market data sockets are unauthenticated by design,
// so put hard caps on how many sockets a single client (or the whole process)
// can hold to prevent resource-exhaustion attacks.
const MAX_SOCKETS_PER_IP = 10;
const MAX_TOTAL_SOCKETS = 500;

const socketsPerIp = new Map();
let totalSockets = 0;

export function attachSocketServer(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
  });

  io.use((socket, next) => {
    const symbol = socket.handshake.query.symbol?.toString()?.trim().toUpperCase();
    if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
      return next(new Error('INVALID_SYMBOL'));
    }

    const ip = socket.handshake.address ?? 'unknown';
    const currentForIp = socketsPerIp.get(ip) ?? 0;
    if (currentForIp >= MAX_SOCKETS_PER_IP || totalSockets >= MAX_TOTAL_SOCKETS) {
      return next(new Error('CONNECTION_LIMIT'));
    }

    socketsPerIp.set(ip, currentForIp + 1);
    totalSockets += 1;
    socket.on('disconnect', () => {
      const updated = (socketsPerIp.get(ip) ?? 1) - 1;
      if (updated > 0) socketsPerIp.set(ip, updated);
      else socketsPerIp.delete(ip);
      totalSockets = Math.max(0, totalSockets - 1);
    });
    return next();
  });

  io.on('connection', (socket) => {
    const symbol = socket.handshake.query.symbol?.toString()?.trim().toUpperCase();
    const room = symbol;
    socket.join(room);
    console.log(`Socket connected for symbol ${symbol}`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected for symbol ${symbol}`);
    });
  });

  subClient.pSubscribe(`${CHANNEL_PREFIX}*`, (message, channel) => {
    const symbol = channel.slice(CHANNEL_PREFIX.length);
    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      return; // ignore malformed broadcasts rather than crashing the relay
    }
    io.to(symbol).emit('orderbook:update', payload);
  });

  subClient.subscribe('market:status', (message) => {
    try {
      const payload = JSON.parse(message);
      io.emit('market:status', payload);
    } catch {
      return;
    }
  });

  return io;
}
