import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import connection, { subClient } from './redis';

let io: Server;

export const clients = new Map();

export const initializeSocket = (server: any) => {
  io = new Server(server);

  io.adapter(createAdapter(connection, subClient));

  io.on('connection', (socket: any) => {
    const userid = (socket.request as any)?.session?.userid;

    if (userid) {
      clients.set(userid, socket.id);
    }

    socket.on('disconnect', () => {
      clients.delete(userid);
    });
  });

  return io;
};

export const getIo = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};
