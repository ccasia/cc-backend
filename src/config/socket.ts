import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import connection, { subClient } from './redis';
import { users } from '../utils/activeUsers';

let io: Server;

export const clients = new Map();

export const initializeSocket = (server: any) => {
  io = new Server(server);

  io.adapter(createAdapter(connection, subClient));

  io.on('connection', (socket: any) => {
    // const userid = (socket.request as any)?.session?.userid;

    socket.on('register', (userId: string) => {
      if (userId) {
        clients.set(userId, socket.id);
        users.set(userId, socket.id);
        socket.join(userId);
      }
    });

    // if (userid) {
    //   clients.set(userid, socket.id);
    // }

    socket.on('disconnect', () => {
      clients.forEach((value, key) => {
        if (value === socket.id) {
          clients.delete(key);
          users.delete(key);
        }
      });
      io.emit('onlineUsers', { onlineUsers: clients.size });
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
