import IORedis from 'ioredis';

const connection = new IORedis({ port: 6379, host: 'redis', maxRetriesPerRequest: null });

export const subClient = connection.duplicate();

export default connection;
