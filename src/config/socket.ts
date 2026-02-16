import { createAdapter } from '@socket.io/redis-adapter';
import { DefaultEventsMap } from 'node_modules/socket.io/dist/typed-events';
import { Server } from 'socket.io';
import connection, { subClient } from './redis';
import { Application } from 'express';

import express from 'express';
import http from 'http';

export const clients = new Map();

export const app: Application = express();
export const server = http.createServer(app);

export const io = new Server(server, {
  connectionStateRecovery: {},
  adapter: createAdapter(connection, subClient),
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
