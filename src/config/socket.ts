import { Server } from 'socket.io';
import * as fs from 'fs';
let io: any;
import path from 'path';
import os from 'os';
import { uploadChatAttachment } from './cloudStorage.config';

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

    // ✅ Add this to handle media upload
    socket.on('sendMedia', async (payload: any) => {
      const { file, senderId, threadId, role, name, photoURL, createdAt } = payload;

      try {
        const base64Data = file.dataURL.replace(/^data:.+;base64,/, '');
        const fileBuffer = Buffer.from(base64Data, 'base64');
        const extension = file.name.split('.').pop();
        const fileName = file.name;
        const fileType = file.type;

        const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${fileName}`);
        fs.writeFileSync(tempFilePath, fileBuffer);

        const result = await uploadChatAttachment(tempFilePath, fileName, threadId, fileType);

        const mediaMessage = {
          senderId,
          threadId,
          role,
          name,
          photoURL,
          createdAt,
          media: {
            url: result.url,
            fileType: result.fileType,
            originalName: result.originalName,
          },
        };

        // Broadcast to both users (same as chat)
        io.to(clients.get('01f17901-100b-4076-935c-1ec02abccace'))
          .to(clients.get('7457ab90-efd3-4f26-8153-c4cc10997257'))
          .emit('message', mediaMessage);

        fs.unlinkSync(tempFilePath); // clean up
      } catch (error) {
        console.error('Media upload failed:', error);
        socket.emit('error', { message: 'Media upload failed' });
      }
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


