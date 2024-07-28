/* eslint-disable no-unused-vars */
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateThreadParams {
  title: string;
  description: string;
  userIds: string[];
  campaignId?: string;
}

interface SendMessageParams {
  threadId: string;
  content: string;
}

export const messagewithThreads = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const thread = await prisma.thread.findUnique({
      where: {
        id: String(threadId),
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
        campaign: true,
      },
    });
    res.status(200).json(threads);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the threads.' });
  }
};

export const getThreadById = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        UserThread: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        campaign: true,
      },
    });

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found.' });
    }

    const userCount = thread.UserThread.length;

    res.status(200).json({
      ...thread,
      userCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the thread.' });
  }
};
export const archiveThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const updatedThread = await prisma.thread.update({
      where: { id: String(threadId) },
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
      where: { id: String(threadId) },
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
  const { title, description, userIds, campaignId } = req.body as CreateThreadParams;

  // Check if the thread is a single chat
  if (userIds.length === 2) {
    try {
      const singleChat = await prisma.thread.findFirst({
        where: {
          isGroup: false,
          archived: false,
          campaignId: null,
          UserThread: {
            every: {
              OR: [{ userId: userIds[0] }, { userId: userIds[1] }],
            },
          },
        },
      });

      if (singleChat) {
        return res.status(200).json(singleChat);
      }
    } catch (error) {
      console.error('Error checking for existing single chat:', error);
      return res.status(500).json({ error: 'An error occurred while checking for existing single chat.' });
    }
  }

  let photoURL = null;

  if (userIds.length === 2) {
    // Fetch the photo URLs of both users
    const userA = await prisma.user.findUnique({ where: { id: userIds[0] } });
    const userB = await prisma.user.findUnique({ where: { id: userIds[1] } });

    const currentUserId = req.session.userid;
    photoURL = currentUserId === userIds[0] ? userB?.photoURL : userA?.photoURL;
    console.log('session', currentUserId);
  }

  try {
    const thread = await prisma.thread.create({
      data: {
        title,
        description,
        archived: false,
        photoURL,
        campaignId: campaignId || null,
        isGroup: userIds.length > 2,
        UserThread: {
          create: userIds.map((userId) => ({
            userId,
          })),
        },
      },
      include: {
        UserThread: true,
        campaign: true,
      },
    });
    res.status(201).json(thread);
    console.log(thread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while creating the thread.' });
  }
};

export const fetchExistingSingleChat = async (req: Request, res: Response) => {
  const { userId, recipientId } = req.query;

  if (!userId || !recipientId) {
    return res.status(400).json({ error: 'Missing userId or recipientId in query parameters.' });
  }

  try {
    const existingSingleChat = await prisma.thread.findFirst({
      where: {
        isGroup: false,
        archived: false,
        UserThread: {
          every: {
            userId: {
              in: [userId as string, recipientId as string],
            },
          },
        },
      },
      include: {
        UserThread: true,
        campaign: true,
      },
    });
    if (existingSingleChat) {
      return res.status(200).json(existingSingleChat);
    } else {
      return res.status(404).json({ error: 'No single chat found.' });
    }
  } catch (error) {
    console.error('Error fetching existing single chat:', error);
    res.status(400).json({ error: 'An error occurred while fetching the existing single chat.' });
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
    res.status(400).json({ error: 'An error occurred while adding the user to the thread.' });
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
        createdAt: new Date(),
      },
    });
    res.status(201).json(message);
    console.log('Message created:', message);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'An error occurred while sending the message.' });
  }
};

// export const sendMessageInThread = async (req: Request, res: Response) => {
//   const { threadId, content } = req.body;
//   const userId = req.session.userid;
//   try {
//     if (!userId) return res.status(400).json({ error: 'Missing sender information.' });
//     const message = await saveMessage(threadId, content, userId);
//     res.status(201).json(message);
//   } catch (error) {
//     console.error(error);
//     res.status(400).json({ error: 'An error occurred while sending the message.' });
//   }
// };

// Function to get all messages from a thread
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

export const getMessagesFromThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;

  try {
    const messages = await fetchMessagesFromThread(threadId);
    res.status(200).json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the messages.' });
  }
};

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
