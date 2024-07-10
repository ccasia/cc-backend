/* eslint-disable no-unused-vars */
import { Request, Response } from 'express';
// import { PrismaClient } from '@prisma/client/extension';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// const prisma = new PrismaClient();

interface CreateThreadParams {
  title: string;
  description: string;
  userIds: string[];
}

interface SendMessageParams {
  threadId: number;
  userId: string;
  content: string;
}

export const messagewithThreads = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const thread = await prisma.thread.findUnique({
      where: {
        id: Number(threadId),
      },
      include: {
        messages: {
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
        },
      },
    });

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found.' });
    }

    res.status(200).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the thread messages.' });
  }
};

export const getAllThreads = async (_req: Request, res: Response) => {
  try {
    const threads = await prisma.thread.findMany({
      include: {
        UserThread: true,
      },
    });
    res.status(200).json(threads);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the threads.' });
  }
};

export const archiveThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const updatedThread = await prisma.thread.update({
      where: { id: Number(threadId) },
      data: { archived: true },
    });

    res.status(200).json({ message: `Thread with ID ${threadId} archived successfully.`, updatedThread });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while archiving the thread.' });
  }
};


export const unarchiveThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const updatedThread = await prisma.thread.update({
      where: { id: Number(threadId) },
      data: { archived: false }, // Set archived to false to unarchive the thread
    });

    res.status(200).json({ message: `Thread with ID ${threadId} unarchived successfully.`, updatedThread });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while unarchiving the thread.' });
  }
};

export const getUserThreads = async (_req: Request, res: Response) => {
  try {
    const userThreads = await prisma.userThread.findMany({
      include: {
        user: true,
        thread: true,
      },
    });
    res.status(200).json(userThreads);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the user threads.' });
  }
};
// Function to create a thread and add initial users
export const createThread = async (req: Request, res: Response) => {
  const { title, description, userIds } = req.body as CreateThreadParams;

  try {
    const thread = await prisma.thread.create({
      data: {
        title,
        description,
        archived: false,
        UserThread: {
          create: userIds.map((userId) => ({
            userId,
          })),
        },
      },
      include: {
        UserThread: true,
      },
    });
    res.status(201).json(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while creating the thread.' });
  }
};

// Function to add a user to an existing thread
export const addUserToThread = async (req: Request, res: Response) => {
  const { threadId, userId } = req.body;

  try {
    const userThread = await prisma.userThread.create({
      data: {
        threadId,
        userId,
      },
    });
    res.status(201).json(userThread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while adding the user to the thread.' });
  }
};

// Function to send a message in a thread
export const sendMessageInThread = async (req: Request, res: Response) => {
  const { threadId, content } = req.body as SendMessageParams;
  const userId = req.session.userid;

  try {
    if (!userId) {
      return res.status(400).json({ error: 'Missing sender information.' });
    }
    const message = await prisma.message.create({
      data: {
        content,
        threadId,
        senderId: userId,
      },
    });
    res.status(201).json(message);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'An error occurred while sending the message.' });
  }
};

// Function to get all messages from a thread
export const getMessagesFromThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const messages = await prisma.message.findMany({
      where: { threadId: Number(threadId) },
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
    res.status(200).json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the messages.' });
  }
};

// // Send a new message
// export const sendMessage = async (req: Request, res: Response) => {
//   const { content, senderId, receiverId } = req.body;

//   try {
//     const message = await prisma.message.create({
//       data: {
//         content,
//         senderId,
//         receiverId,
//       },
//     });
//     res.status(201).json(message);
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ error: 'An error occurred while sending the message.' });
//   }
// };

// // Get messages between two users
// export const getMessages = async (req: Request, res: Response) => {
//   const { senderId, receiverId } = req.params;

//   try {
//     const messages = await prisma.message.findMany({
//       where: {
//         OR: [
//           { senderId, receiverId },
//           { senderId: receiverId, receiverId: senderId },
//         ],
//       },
//       orderBy: { createdAt: 'asc' },
//     });
//     res.status(200).json(messages);
//   } catch (error) {
//     res.status(500).json({ error: 'An error occurred while retrieving the messages.' });
//   }
// };

// // Mark a message as read
// export const markAsRead = async (req: Request, res: Response) => {
//   const { messageId } = req.params;

//   try {
//     const message = await prisma.message.update({
//       where: { id: parseInt(messageId) },
//       data: { read: true },
//     });
//     res.status(200).json(message);
//   } catch (error) {
//     res.status(500).json({ error: 'An error occurred while marking the message as read.' });
//   }
// };
