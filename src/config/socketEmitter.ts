// config/socketEmitter.ts
import { Emitter } from '@socket.io/redis-emitter';
import connection from './redis';

// Emitter just needs a pub client — no HTTP server required
export const emitter = new Emitter(connection);
