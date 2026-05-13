import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { markMessagesService, sendMessageService, ThreadServiceError } from '@services/threadService';
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

export const sendMyMessage = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { threadId } = req.params;
  const { content, clientNonce, fileWidth, fileHeight } = req.body as {
    content?: string;
    clientNonce?: string;
    fileWidth?: string | number;
    fileHeight?: string | number;
  };

  // multipart/form-data sends everything as strings; coerce to integers, drop
  // anything non-positive or non-numeric.
  const parseDim = (v: string | number | undefined): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const parsedFileWidth = parseDim(fileWidth);
  const parsedFileHeight = parseDim(fileHeight);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!threadId) {
    return res.status(400).json({ error: 'Missing threadId.' });
  }

  let file = null;
  if (req.files && (req.files as any).attachments) {
    const raw = (req.files as any).attachments;
    file = Array.isArray(raw) ? raw[0] : raw;
  }

  if (!file && !(content && content.trim().length > 0)) {
    return res.status(400).json({ error: 'Message must include text or an attachment.' });
  }

  try {
    const message = await sendMessageService({
      userId,
      threadId,
      content,
      file,
      fileWidth: parsedFileWidth,
      fileHeight: parsedFileHeight,
      allowedMimePrefix: ['image/', 'video/'],
      maxFileSize: 1024 * 1024 * 1024, // 1 GB
      clientNonce,
    });
    return res.status(201).json(message);
  } catch (error) {
    if (error instanceof ThreadServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('mobile sendMyMessage error:', error);
    return res.status(500).json({ error: 'Failed to send message.' });
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
