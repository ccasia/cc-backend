import IORedis from 'ioredis';

const connection = new IORedis({
  port: Number(process.env.REDIS_PORT) || 6379,
  host: process.env.REDIS_HOST || 'redis',
  maxRetriesPerRequest: null,
  password: process.env.REDIS_PASSWORD || 'cult-redis',
});

export const subClient = connection.duplicate();

export default connection;
