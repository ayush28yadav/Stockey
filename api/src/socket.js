import { Server } from 'socket.io';
import { subClient } from './redis.js';

const CHANNEL_PREFIX = 'orderbook:';

export function attachSocketServer(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
  });

  io.on('connection', (socket) => {
    const symbol = socket.handshake.query.symbol?.toString()?.toUpperCase();
    if (!symbol) {
      socket.disconnect(true);
      return;
    }
    const room = symbol;
    socket.join(room);
    console.log(`Socket connected for symbol ${symbol}`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected for symbol ${symbol}`);
    });
  });

  subClient.pSubscribe(`${CHANNEL_PREFIX}*`, (message, channel) => {
    const symbol = channel.slice(CHANNEL_PREFIX.length);
    io.to(symbol).emit('orderbook:update', JSON.parse(message));
  });

  return io;
}
