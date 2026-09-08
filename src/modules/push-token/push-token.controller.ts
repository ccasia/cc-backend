import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const registerPushToken = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { token, platform, deviceId } = req.body as {
    token?: string;
    platform?: string;
    deviceId?: string;
  };

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!token || !platform) {
    return res.status(400).json({ error: 'token and platform are required' });
  }

  try {
    const record = await prisma.pushToken.upsert({
      where: { token },
      create: {
        token,
        platform,
        deviceId: deviceId ?? null,
        userId,
      },
      update: {
        userId,
        platform,
        deviceId: deviceId ?? null,
      },
    });

    return res.status(200).json({ pushToken: record });
  } catch (error) {
    console.error('Error registering push token:', error);
    return res.status(500).json({ error: 'Failed to register push token' });
  }
};

export const removePushToken = async (req: Request, res: Response) => {
  const userId = req.userId;
  const { token } = req.body as { token?: string };

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    await prisma.pushToken.deleteMany({
      where: { token, userId },
    });
    return res.sendStatus(204);
  } catch (error) {
    console.error('Error removing push token:', error);
    return res.status(500).json({ error: 'Failed to remove push token' });
  }
};
