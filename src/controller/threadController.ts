/* eslint-disable no-unused-vars */
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { markMessagesService, fetchMessagesFromThread, totalUnreadMessagesService } from '@services/threadService';
import { clients, io } from '../server';
import { uploadImage, uploadAgreementForm, uploadPitchVideo } from '@configs/cloudStorage.config';
import { notificationCSMChat, notificationGroupChat } from '@helper/notification';
import { saveNotification } from './notificationController';

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

export const getUserThreads = async (req: Request, res: Response) => {
  try {
    const userThreads = await prisma.userThread.findMany({
      include: {
        user: true,
        thread: true,
      },
    });
  

    // Extract only the thread data
    const threads = userThreads.map((userThread) => userThread.thread);

    res.status(200).json(threads);
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
          // Change this
          AND: [
            {
              UserThread: {
                some: {
                  userId: userIds[0],
                },
              },
            },
            {
              UserThread: {
                some: {
                  userId: userIds[1],
                },
              },
            },
          ],
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
    return res.status(201).json(thread);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'An error occurred while creating the thread.' });
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
  
  
  console.log("Fileeess", req.files); // Log the uploaded files for debugging
  
  try {
    let fileURL: string | null = null;
    let fileType: string | null = null;
  
    if (req.files && req.files.file) {
      const file = req.files.file; 
    
      if (file && !Array.isArray(file)) {
        const { mimetype, tempFilePath, name } = file;
    
        console.log("File received:", file);
    
        if (mimetype.startsWith('image/')) {
          fileURL = await uploadImage(tempFilePath, name, 'chat-images');
          fileType = mimetype;
        } else if (mimetype.startsWith('video/')) {
          fileURL = await uploadPitchVideo(tempFilePath, name, 'chat-videos');
          fileType = mimetype;
        } else if (mimetype === 'application/pdf') {
          fileURL = await uploadAgreementForm(tempFilePath, name, 'chat-pdfs');
          fileType = mimetype;
        } else {
          console.log('Unsupported file type:', mimetype);
        }
      } else {
        console.error('File is not an expected object');
      }
    } else {
      console.log('No file uploaded');
    }
     
    console.log('Generated URL:', fileURL);

    const datas = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          content: content,  
          file: fileURL,
          fileType: fileType,
          threadId,
          senderId: userId,
          createdAt: new Date(),
        },
      });

      const data = await tx.thread.update({
        where: { id: threadId },
        data: { latestMessageId: message.id },
        include: {
          campaign: true,
          UserThread: {
            include: {
              user: true,
            },
          },
          unreadMessages: true,
        },
      });

      const unreadMessageData = data.UserThread
        .filter((thread) => thread.user.id !== userId)
        .map((thread) => ({
          userId: thread.user.id,
          threadId,
          messageId: message.id,
        }));

      console.log("Data to create for unread messages:", unreadMessageData);

      if (unreadMessageData.length > 0) {
        try {
          await tx.unreadMessage.createMany({
            data: unreadMessageData,
          });
          console.log("Unread messages created successfully");
        } catch (error) {
          console.error("Error creating unread messages:", error);
        }
      }

      console.log ( " Unread data", unreadMessageData)

      return { data, message };
    });

   

    io.to(threadId).emit('message', {
      senderId: userId,
      threadId,
      content,
      file: fileURL,   
      fileType,
      sender: { role: 'user', name: 'User', photoURL: '' },
      createdAt: new Date().toISOString(),
    });

    console.log("Emitting message to thread:", {
      senderId: userId,
      threadId,
      content,
      file: fileURL,
      fileType,
      sender: { role: 'user', name: 'User', photoURL: '' },
      createdAt: new Date().toISOString(),
    });

    const userIds = datas.data.UserThread.map((thread) => thread.user.id);

    // Proceed only if the thread has an associated campaign
    if (datas.data.campaign) {
      const userIds = datas.data.UserThread.map((thread) => thread.user.id);
      const { title, message: notificationMessage } = notificationGroupChat(datas.data.campaign.name, datas.data.title);

      // Create notifications for all users in the thread, except the sender
      for (const thread of datas.data.UserThread.filter((t) => t.user.id !== userId)) {
        const notification = await saveNotification({
          userId: thread.user.id,
          message: notificationMessage,
          title,
          entity: 'Chat',
          threadId: datas.data.id,
          entityId: datas.data.campaign.id,
        });

        // Emit notification event for real-time updates
        io.to(clients.get(thread.user.id)).emit('notification', notification);
      }
    }

    if (!datas.data.campaign) {
      const { title, message: notificationMessage } = notificationCSMChat(datas.data.title);

      for (const thread of datas.data.UserThread.filter((t) => t.user.id !== userId)) {
        const notification = await saveNotification({
          userId: thread.user.id,
          message: notificationMessage,
          title,
          threadId: datas.data.id,
          entity: 'Chat',
        });

        io.to(clients.get(thread.user.id)).emit('notification', notification);
      }
    }

    const unreadMessages = await prisma.unreadMessage.groupBy({
      by: ['userId'],
      _count: true,
      where: {
        userId: { in: userIds },
        threadId: threadId,
      },
    });

    console.log("UnreadMessage aggregation result:", unreadMessages);

    const unreadCountMap = new Map(unreadMessages.map((count) => [count.userId, count._count]));
    const senderInformation = datas.data.UserThread.find((elem) => elem.userId === userId);

    for (const thread of datas.data.UserThread.filter((elem) => elem.userId !== userId)) {
      const count = unreadCountMap.get(thread.user.id) || 0;

      console.log('Emitting messageCount:', {
        count,
        name: senderInformation?.user.name,
      });
      
      io.to(clients.get(thread.user.id)).emit('messageCount', { count, name: senderInformation?.user.name });
    }

    console.log ("Datas created", datas.message)
    return res.status(200).json( datas.message);
    // return res.status(201).json(datas.message);
  } catch (error) {
    console.log(error);
    return res.status(400).json({ error: 'An error occurred while sending the message.' });
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

    return res.status(200).json({ unreadCount });
  } catch (error) {
    return res.status(500).json({ error: 'An error occurred while fetching unread message count.' });
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


