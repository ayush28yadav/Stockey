import { createClient } from 'redis';
import { config } from './config.js';

export const redisClient = createClient({ url: config.REDIS_URL });
redisClient.on('error', (error) => console.error('Redis client error', error));

export const pubClient = createClient({ url: config.REDIS_URL });
pubClient.on('error', (error) => console.error('Redis pub client error', error));

export const subClient = createClient({ url: config.REDIS_URL });
subClient.on('error', (error) => console.error('Redis sub client error', error));

export async function connectRedis() {
  await redisClient.connect();
}

export async function connectPubSub() {
  await pubClient.connect();
  await subClient.connect();
}

export async function closePubSubClients() {
  try {
    await subClient.pUnsubscribe();
  }
  catch (error) {
    console.error('Error unsubscribing Redis pub/sub:', error);
  }
  await subClient.quit();
  await pubClient.quit();
}
