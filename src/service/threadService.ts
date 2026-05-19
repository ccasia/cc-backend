import { PrismaClient } from '@prisma/client';
import { sendMessageInThread } from '@controllers/threadController';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { uploadAttachments, uploadAttachmentStream } from '@configs/cloudStorage.config';
import { clients, io } from '../server';
import { notificationCSMChat, notificationGroupChat } from '@helper/notification';
import { saveNotification } from '@controllers/notificationController';

const prisma = new PrismaClient();

export class ThreadServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const assertThreadMembership = async (userId: string, threadId: string) => {
  const membership = await prisma.userThread.findUnique({
    where: { userId_threadId: { userId, threadId } },
  });
  if (!membership) {
    throw new ThreadServiceError(403, 'Not a member of this thread.');
  }
};

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

type UploadedFile = {
  tempFilePath: string;
  name: string;
  mimetype: string;
  size: number;
};

type SendMessageInput = {
  userId: string;
  threadId: string;
  content?: string;
  file?: UploadedFile | null;
  fileWidth?: number | null;
  fileHeight?: number | null;
  allowedMimePrefix?: string | string[];
  allowedExactMimes?: string[];
  maxFileSize?: number;
  clientNonce?: string;
};

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const sendMessageService = async ({
  userId,
  threadId,
  content,
  file,
  fileWidth,
  fileHeight,
  allowedMimePrefix,
  allowedExactMimes,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  clientNonce,
}: SendMessageInput) => {
  await assertThreadMembership(userId, threadId);

  let fileUrl: string | null = null;
  let fileType: string | null = null;

  if (file) {
    if (allowedMimePrefix || allowedExactMimes) {
      const prefixes = allowedMimePrefix
        ? Array.isArray(allowedMimePrefix)
          ? allowedMimePrefix
          : [allowedMimePrefix]
        : [];
      const exact = allowedExactMimes ?? [];
      const mimeOk =
        prefixes.some((p) => file.mimetype.startsWith(p)) || exact.includes(file.mimetype);
      if (!mimeOk) {
        throw new ThreadServiceError(415, `Unsupported file type: ${file.mimetype}`);
      }
    }
    if (file.size > maxFileSize) {
      throw new ThreadServiceError(413, `File too large. Max ${maxFileSize} bytes.`);
    }

    const safeName = sanitizeFileName(file.name);
    const uniqueFileName = `${userId}-${Date.now()}-${randomUUID()}-${safeName}`;

    if (file.mimetype.startsWith('video/')) {
      const senderSocketId = clients.get(userId);
      fileUrl = await uploadAttachmentStream({
        tempFilePath: file.tempFilePath,
        fileName: uniqueFileName,
        folderName: 'chat-attachments',
        contentType: file.mimetype,
        size: file.size,
        progressCallback: clientNonce && senderSocketId
          ? (percent) => io.to(senderSocketId).emit('attachmentProgress', { clientNonce, percent })
          : undefined,
      });
    } else {
      fileUrl = await uploadAttachments({
        tempFilePath: file.tempFilePath,
        fileName: uniqueFileName,
        folderName: 'chat-attachments',
      });
    }
    fileType = file.mimetype;
  }

  const datas = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        content: content || '',
        threadId,
        senderId: userId,
        file: fileUrl,
        fileType,
        // Only meaningful when an attachment is present; clients send these
        // alongside the upload so server-loaded messages render at the
        // correct aspect ratio without a fallback flash.
        fileWidth: fileUrl ? (fileWidth ?? null) : null,
        fileHeight: fileUrl ? (fileHeight ?? null) : null,
        fileName: file ? file.name : null,
        fileSize: file ? file.size : null,
        createdAt: new Date(),
      },
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

    const data = await tx.thread.update({
      where: { id: threadId },
      data: { latestMessageId: message.id },
      include: {
        campaign: true,
        UserThread: {
          include: { user: true },
        },
        unreadMessages: true,
      },
    });

    return { data, message };
  });

  io.to(threadId).emit('message', {
    id: datas.message.id,
    content: datas.message.content,
    senderId: datas.message.senderId,
    threadId: datas.message.threadId,
    file: datas.message.file,
    fileType: datas.message.fileType,
    fileWidth: datas.message.fileWidth,
    fileHeight: datas.message.fileHeight,
    fileName: datas.message.fileName,
    fileSize: datas.message.fileSize,
    createdAt: datas.message.createdAt,
    sender: datas.message.sender,
    clientNonce,
  });

  const recipientIds = datas.data.UserThread.map((t) => t.user.id).filter((id) => id !== userId);

  // Notifications (preserves existing behavior — campaign vs CSM thread)
  const notifyAll = async () => {
    const isCampaign = Boolean(datas.data.campaign);
    const { title, message: notificationMessage } = isCampaign
      ? notificationGroupChat(datas.data.campaign!.name, datas.data.title)
      : notificationCSMChat(datas.data.title);

    for (const recipientId of recipientIds) {
      const notification = await saveNotification({
        userId: recipientId,
        message: notificationMessage,
        title,
        entity: 'Chat',
        threadId: datas.data.id,
        ...(isCampaign ? { entityId: datas.data.campaign!.id } : {}),
      });
      io.to(clients.get(recipientId)).emit('notification', notification);
    }
  };
  await notifyAll();

  // Unread message rows are only created for direct API calls (file sends).
  // Socket text-only sends create unread rows in handleSendMessage instead.
  if (fileUrl && recipientIds.length > 0) {
    await prisma.unreadMessage.createMany({
      data: recipientIds.map((rid) => ({
        userId: rid,
        threadId,
        messageId: datas.message.id,
      })),
      skipDuplicates: true,
    });
  }

  // Per-recipient unread count broadcast
  const unreadMessages = await prisma.unreadMessage.groupBy({
    by: ['userId'],
    _count: true,
    where: {
      userId: { in: recipientIds },
      threadId,
    },
  });
  const unreadCountMap = new Map(unreadMessages.map((c) => [c.userId, c._count]));
  const sender = datas.data.UserThread.find((ut) => ut.userId === userId);

  for (const recipientId of recipientIds) {
    const count = unreadCountMap.get(recipientId) || 0;
    io.to(clients.get(recipientId)).emit('messageCount', { count, name: sender?.user.name });
  }

  return datas.message;
};

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

export const handleSendMessage = async (message: any, io: any) => {
  const { senderId, threadId, content, role, name, photoURL } = message;

  // Simulate the request and response for calling the API endpoint
  const req = {
    body: {
      threadId,
      content,
    },
    userId: senderId,
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
          // Socket emission is handled inside sendMessageInThread (with the
          // saved DB message, including its `id`). Emitting again here would
          // duplicate the message in clients that dedupe by id, because this
          // synthetic payload has no `id`.

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
