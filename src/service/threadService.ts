import { PrismaClient } from '@prisma/client';
import { sendMessageInThread } from '@controllers/threadController';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const markMessagesService = async (threadId: string, userId: string) => {
  try {
    // Find all unread messages for the user in the thread
    const unreadMessages = await prisma.unreadMessage.findMany({
      where: {
        threadId,
        userId,
      },
    });

    if (unreadMessages.length === 0) {
      return { message: 'No unread messages to mark as seen.' };
    }

    // Create seen messages and delete the unread messages
    const seenMessages = unreadMessages.map((unreadMessage) => ({
      userId: userId as string,
      messageId: unreadMessage.messageId,
    }));

    await prisma.seenMessage.createMany({
      data: seenMessages,
    });

    await prisma.unreadMessage.deleteMany({
      where: {
        threadId,
        userId,
      },
    });

    return { message: 'Messages marked as seen.' };
  } catch (error) {
    console.error('Error marking messages as seen:', error);
    throw new Error('Failed to mark messages as seen.');
  }
};

export const totalUnreadMessagesService = async (userId: string) => {
  try {
    const unreadCount = await prisma.unreadMessage.count({
      where: {
        userId,
      },
    });

    return unreadCount;
  } catch (error) {
    console.error('Error in getting total count:', error);
    throw new Error('Failed to get total unread message count.');
  }
};


// export const handleSendMessage = async (message: any, io: any) => {
//   const { senderId, threadId, content, role, name, photoURL } = message;

//   // Simulate the request and response for calling the API endpoint
//   const req = {
//     body: {
//       threadId,
//       content,
//     },
//     session: {
//       userid: senderId,
//     },
//     app: {
//       get: (key: string) => {
//         if (key === 'io') return io;
//         return null;
//       },
//     },
//   } as Partial<Request>;

//   const res = {
//     status: (code: number) => ({
//       json: async (data: any) => {
//         if (code === 201) {
//           console.log('Message saved:', data);
//           // Fetch all users in the thread except the sender
//           const usersInThread = await prisma.userThread.findMany({
//             where: {
//               threadId,
//               userId: { not: senderId },
//             },
//             select: {
//               userId: true,
//             },
//           });

//           // Create unread messages for each user in the thread
//           const unreadMessages = usersInThread.map(({ userId }: any) => ({
//             userId,
//             threadId,
//             messageId: data.id,
//           }));

//           await prisma.unreadMessage.createMany({
//             data: unreadMessages,
//             skipDuplicates: true,
//           });
//         } else {
          
//           console.error('Error saving message this is not working:', data);
//         }
//       },
//     }),
//   } as unknown as Response;

//   await sendMessageInThread(req as Request, res);
// };


// export const handleFetchMessagesFromThread = async (threadId: any) => {
//   try {
//     // Fetch old messages using the service
//     const oldMessages = await fetchMessagesFromThread(threadId);
//     return oldMessages;
//   } catch (error) {
//     console.error('Error fetching messages:', error);
//     throw new Error('Failed to fetch messages');
//   }
// };

// // Function to get all messages from a thread
export const fetchMessagesFromThread = async (threadId: string) => {
  try {
    const messages = await prisma.message.findMany({
      where: { threadId: String(threadId) },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            photoURL: true,
            role: true,
          },
        },
      },
    });
    return messages;
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw new Error('Failed to fetch messages');
  }
};
