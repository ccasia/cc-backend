import { Server } from 'socket.io';
let io: any;

export const clients = new Map();

export const initializeSocket = (server: any) => {
  io = new Server(server);
  io.on('connection', (socket: any) => {
    const userid = (socket.request as any).session.userid;

    if (userid) {
      clients.set(userid, socket.id);
    }

    socket.on('chat', (data: any) => {
      io.to(clients.get('01f17901-100b-4076-935c-1ec02abccace'))
        .to(clients.get('7457ab90-efd3-4f26-8153-c4cc10997257'))
        .emit('message', data);
    });

    socket.on('disconnect', () => {
      clients.delete(userid);
    });
  });
};

export const getIo = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};
