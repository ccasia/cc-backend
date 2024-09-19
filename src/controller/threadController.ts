/* eslint-disable no-unused-vars */
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { markMessagesService, fetchMessagesFromThread, totalUnreadMessagesService } from '@services/threadService';

const prisma = new PrismaClient();

interface CreateThreadParams {
  title: string;
  description: string;
  userIds: string[];
  campaignId?: string;
  photoURL?: string;
}

interface SendMessageParams {
  threadId: string;
  content: string;
}

export const getAllThreads = async (_req: Request, res: Response) => {
  try {
    const threads = await prisma.thread.findMany({
      include: {
        UserThread: {
          include: {
            user: true,
          },
        },
        campaign: true,
        latestMessage: true,
      },
      orderBy: {
        latestMessage: {
          createdAt: 'desc', // Order threads by the most recent message
        },
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
            user: true,
          },
        },
        campaign: true,
        latestMessage: true,
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
  const userId = req.session.userid;
  try {
    const updatedUserThread = await prisma.userThread.update({
      where: {
        userId_threadId: {
          userId: String(userId),
          threadId: String(threadId),
        },
      },
      data: { archived: true },
    });
    res
      .status(200)
      .json({ message: `Thread with ID ${threadId} archived with user ${userId} successfully.`, updatedUserThread });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while archiving the thread.' });
  }
};

export const unarchiveThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const userId = req.session.userid;
  try {
    const updatedUserThread = await prisma.userThread.update({
      where: {
        userId_threadId: {
          userId: String(userId),
          threadId: String(threadId),
        },
      },
      data: { archived: false },
    });

    res.status(200).json({ message: `Thread with ID ${threadId} unarchived successfully.`, updatedUserThread });
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
  const { title, description, userIds, campaignId, photoURL } = req.body as CreateThreadParams;

  // Check if the thread is a single chat
  if (userIds.length === 2) {
    try {
      const singleChat = await prisma.thread.findFirst({
        where: {
          isGroup: false,
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
  try {
    const thread = await prisma.thread.create({
      data: {
        title,
        description,
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
    //console.log(thread);
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

    await prisma.thread.update({
      where: { id: threadId },
      data: { latestMessageId: message.id },
    });

    res.status(201).json(message);
    //console.log('Message created:', message);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'An error occurred while sending the message.' });
  }
};

export const getMessagesFromThread = async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const userId = req.session.userid;
  try {
    const messages = await fetchMessagesFromThread(threadId);

    const unreadMessages = await prisma.unreadMessage.findMany({
      where: {
        threadId,
        userId,
      },
    });
    //console.log('Unread messages to be deleted:', unreadMessages);

    // Delete unread messages
    if (unreadMessages.length > 0) {
      await prisma.unreadMessage.deleteMany({
        where: {
          threadId,
          userId,
        },
      });
      //console.log('Unread messages marked as seen.');
    }
    res.status(200).json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while retrieving the messages.' });
  }
};

export const getUnreadMessageCount = async (req: Request, res: Response) => {
  const userId = req.session.userid;
  const { threadId } = req.params;

  try {
    if (!userId) {
      return res.status(400).json({ error: 'Missing user information.' });
    }

    const unreadCount = await prisma.unreadMessage.count({
      where: {
        userId,
        threadId,
      },
    });

    res.status(200).json({ unreadCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred while fetching unread message count.' });
  }
};

export const getTotalUnreadMessageCount = async (req: Request, res: Response) => {
  const userId = req.session.userid;

  if (!userId) {
    return res.status(400).json({ error: 'Missing user information.' });
  }

  try {
    const unreadCount = await totalUnreadMessagesService(userId);
    res.status(200).json({ unreadCount });
  } catch (error) {
    console.error('Error fetching total unread message count:', error);
    res.status(500).json({ error: 'An error occurred while fetching total unread message count.' });
  }
};

// Mark a message as read
export const markMessagesAsSeen = async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const userId = req.session.userid;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is missing from the session.' });
  }

  try {
    const result = await markMessagesService(threadId, userId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error marking messages as seen:', error);
    res.status(500).json({ error: 'An error occurred while marking messages as seen.' });
  }
};
