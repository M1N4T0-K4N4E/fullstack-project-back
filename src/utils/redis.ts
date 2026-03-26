import { Redis } from 'ioredis';
import { serverLogger } from './logger.js';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number.parseInt(process.env.REDIS_PORT || '3002'),
});

redis.on('connect', () => {
  serverLogger.info('Redis client connected');
});

redis.on('error', (err: Error) => {
  serverLogger.error('Redis client error', { error: err });
});

export default redis;
