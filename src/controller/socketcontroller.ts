// @controllers/socketController.ts
import { PrismaClient } from '@prisma/client';
import { sendMessageInThread } from './threadController';
import { fetchMessagesFromThread } from './service/threadService';
import { Request, Response } from 'express';
const prisma = new PrismaClient();

export const handleSendMessage = async (message: any, io: any) => {
  const { senderId, threadId, content, role, name, photoURL } = message;

  // Simulate the request and response for calling the API endpoint
  const req = {
    body: {
      threadId,
      content,
    },
    session: {
      userid: senderId,
    },
    app: {
      get: (key: string) => {
        if (key === 'io') return io;
        return null;
      },
    },
  } as Partial<Request>;

  const res = {
    status: (code: number) => ({
      json: async (data: any) => {
        if (code === 201) {
          // console.log('Message saved:', data);
          io.to(threadId).emit('message', {
            senderId,
            threadId,
            content,
            sender: { role, name, photoURL },
            createdAt: new Date().toISOString(),
          });

          // Fetch all users in the thread except the sender
          const usersInThread = await prisma.userThread.findMany({
            where: {
              threadId,
              userId: { not: senderId },
            },
            select: {
              userId: true,
            },
          });

          // Create unread messages for each user in the thread
          const unreadMessages = usersInThread.map(({ userId }: any) => ({
            userId,
            threadId,
            messageId: data.id,
          }));

          await prisma.unreadMessage.createMany({
            data: unreadMessages,
            skipDuplicates: true,
          });
        } else {
          console.error('Error saving message:', data);
        }
      },
    }),
  } as unknown as Response;

  await sendMessageInThread(req as Request, res);
};

export const handleFetchMessagesFromThread = async (threadId: any) => {
  try {
    // Fetch old messages using the service
    const oldMessages = await fetchMessagesFromThread(threadId);
    return oldMessages;
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw new Error('Failed to fetch messages');
  }
};
