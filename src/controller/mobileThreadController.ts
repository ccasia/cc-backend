import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { markMessagesService } from '@services/threadService';
import { io } from '../server';

const prisma = new PrismaClient();

export const getMyThreads = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const threads = await prisma.thread.findMany({
      where: {
        UserThread: {
          some: { userId },
        },
      },
      include: {
        UserThread: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                photoURL: true,
                role: true,
                admin: {
                  select: {
                    role: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        campaign: {
          select: { id: true, name: true },
        },
        latestMessage: {
          include: {
            sender: {
              select: { id: true, name: true, photoURL: true, role: true },
            },
          },
        },
        _count: {
          select: {
            unreadMessages: { where: { userId } },
          },
        },
      },
      orderBy: {
        latestMessage: { createdAt: 'desc' },
      },
    });

    return res.status(200).json(threads);
  } catch (error) {
    console.error('mobile getMyThreads error:', error);
    return res.status(500).json({ error: 'An error occurred while retrieving threads.' });
  }
};

export const getMyThreadMessages = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { threadId } = req.params;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const isMember = await prisma.userThread.findUnique({
      where: { userId_threadId: { userId, threadId } },
    });

    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const messages = await prisma.message.findMany({
      where: { threadId: String(threadId) },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { id: true, name: true, photoURL: true, role: true },
        },
        seenMessages: { select: { userId: true } },
      },
    });

    await prisma.unreadMessage.deleteMany({
      where: { threadId, userId },
    });

    return res.status(200).json(messages);
  } catch (error) {
    console.error('mobile getMyThreadMessages error:', error);
    return res.status(500).json({ error: 'An error occurred while retrieving messages.' });
  }
};

export const markThreadSeen = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { threadId } = req.params;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const isMember = await prisma.userThread.findUnique({
      where: { userId_threadId: { userId, threadId } },
    });

    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const result = await markMessagesService(threadId, userId);
    io.to(threadId).emit('messagesSeen', { threadId, userId });
    return res.status(200).json(result);
  } catch (error) {
    console.error('mobile markThreadSeen error:', error);
    return res.status(500).json({ error: 'An error occurred while marking messages as seen.' });
  }
};
