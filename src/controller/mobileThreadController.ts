import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  deleteMessageService,
  editMessageService,
  fetchMessagesFromThread,
  markMessagesService,
  sendMessageService,
  ThreadServiceError,
} from '@services/threadService';
import { CHAT_DOC_ALLOWED_MIMES, CHAT_DOC_MAX_SIZE } from '@constants/chatFileTypes';
import { getLinkPreviewForUrl } from '@services/linkPreviewService';

import { getIo } from '../config/socket';

const prisma = new PrismaClient();

const mobileThreadInclude = (userId: string) => ({
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
});

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
      include: mobileThreadInclude(userId),
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

export const startDirectThread = async (req: Request, res: Response) => {
  const userId = req.userId;
  const recipientUserId = typeof req.body.recipientUserId === 'string' ? req.body.recipientUserId : '';

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!recipientUserId) {
    return res.status(400).json({ error: 'Missing recipientUserId.' });
  }
  if (recipientUserId === userId) {
    return res.status(400).json({ error: 'Cannot start a chat with yourself.' });
  }

  try {
    const users = await prisma.user.findMany({
      where: { id: { in: [userId, recipientUserId] } },
      select: { id: true, name: true },
    });
    const currentUser = users.find((user) => user.id === userId);
    const recipient = users.find((user) => user.id === recipientUserId);

    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found.' });
    }

    const existingThread = await prisma.thread.findFirst({
      where: {
        isGroup: false,
        campaignId: null,
        AND: [{ UserThread: { some: { userId } } }, { UserThread: { some: { userId: recipientUserId } } }],
      },
      include: mobileThreadInclude(userId),
    });

    if (existingThread) {
      return res.status(200).json(existingThread);
    }

    const thread = await prisma.thread.create({
      data: {
        title: `Chat between ${currentUser?.name ?? 'Creator'} & ${recipient.name ?? 'Campaign Admin'}`,
        description: '',
        photoURL: null,
        campaignId: null,
        isGroup: false,
        UserThread: {
          create: [{ userId }, { userId: recipientUserId }],
        },
      },
      include: mobileThreadInclude(userId),
    });

    return res.status(201).json(thread);
  } catch (error) {
    console.error('mobile startDirectThread error:', error);
    return res.status(500).json({ error: 'An error occurred while starting the chat.' });
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

    const messages = await fetchMessagesFromThread(threadId);

    return res.status(200).json(messages);
  } catch (error) {
    console.error('mobile getMyThreadMessages error:', error);
    return res.status(500).json({ error: 'An error occurred while retrieving messages.' });
  }
};

export const getThreadLinkPreview = async (req: Request, res: Response) => {
  const userId = req.userId;
  const url = typeof req.query.url === 'string' ? req.query.url : '';

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!url) {
    return res.status(400).json({ error: 'Missing url.' });
  }

  try {
    const preview = await getLinkPreviewForUrl(url);
    return res.status(200).json(preview);
  } catch (error) {
    console.error('mobile getThreadLinkPreview error:', error);
    return res.status(500).json({ error: 'Failed to retrieve link preview.' });
  }
};

export const sendMyMessage = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { threadId } = req.params;
  const { content, clientNonce, fileWidth, fileHeight, replyToMessageId } = req.body as {
    content?: string;
    clientNonce?: string;
    fileWidth?: string | number;
    fileHeight?: string | number;
    replyToMessageId?: string | number;
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
  const parsedReplyToId = parseDim(replyToMessageId);

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

  // Document MIME / size guards. Images and videos keep the existing prefix
  // allowlist and 1 GB ceiling; documents have an exact-MIME allowlist and a
  // tighter 100 MB cap so we reject early before streaming to GCS.
  if (file) {
    const mime: string = file.mimetype ?? '';
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');
    const isDoc = CHAT_DOC_ALLOWED_MIMES.includes(mime);
    if (!isImage && !isVideo && !isDoc) {
      return res.status(415).json({
        error: 'File type not allowed. Accepted: images, videos, PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV.',
      });
    }
    if (isDoc && typeof file.size === 'number' && file.size > CHAT_DOC_MAX_SIZE) {
      return res.status(413).json({ error: 'Document exceeds the 100 MB limit.' });
    }
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
      allowedExactMimes: CHAT_DOC_ALLOWED_MIMES,
      maxFileSize: 1024 * 1024 * 1024, // 1 GB
      clientNonce,
      replyToId: parsedReplyToId,
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
    getIo().to(threadId).emit('messagesSeen', result);
    return res.status(200).json(result);
  } catch (error) {
    console.error('mobile markThreadSeen error:', error);
    return res.status(500).json({ error: 'An error occurred while marking messages as seen.' });
  }
};

const parseMessageId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const editMyMessage = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { threadId, messageId } = req.params;
  const content = typeof req.body.content === 'string' ? req.body.content : '';
  const parsedMessageId = parseMessageId(messageId);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!parsedMessageId) {
    return res.status(400).json({ error: 'Invalid messageId.' });
  }

  try {
    const message = await editMessageService({
      userId,
      threadId,
      messageId: parsedMessageId,
      content,
    });
    return res.status(200).json(message);
  } catch (error) {
    if (error instanceof ThreadServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('mobile editMyMessage error:', error);
    return res.status(500).json({ error: 'Failed to edit message.' });
  }
};

export const deleteMyMessage = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { threadId, messageId } = req.params;
  const parsedMessageId = parseMessageId(messageId);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!parsedMessageId) {
    return res.status(400).json({ error: 'Invalid messageId.' });
  }

  try {
    const message = await deleteMessageService({
      userId,
      threadId,
      messageId: parsedMessageId,
    });
    return res.status(200).json(message);
  } catch (error) {
    if (error instanceof ThreadServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('mobile deleteMyMessage error:', error);
    return res.status(500).json({ error: 'Failed to delete message.' });
  }
};
