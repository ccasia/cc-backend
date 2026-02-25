import IORedis from 'ioredis';

const connection = new IORedis({
  port: 6379,
  host: 'redis',
  maxRetriesPerRequest: null,
  password: process.env.REDIS_PASSWORD || 'cult-redis',
});

export const subClient = connection.duplicate();

export default connection;
