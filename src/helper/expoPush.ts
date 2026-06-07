import { PrismaClient } from '@prisma/client';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

const prisma = new PrismaClient();
const expo = new Expo();

interface ExpoPushPayload {
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  collapseId?: string; // for stacking notifications
}

export const sendExpoPushToUser = async (userId: string, payload: ExpoPushPayload) => {
  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { id: true, token: true },
    });

    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = [];
    const invalidTokenIds: string[] = [];

    for (const t of tokens) {
      if (!Expo.isExpoPushToken(t.token)) {
        invalidTokenIds.push(t.id);
        continue;
      }
      messages.push({
        to: t.token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        ...(payload.collapseId ? { collapseId: payload.collapseId } : {}),
      });
    }

    if (invalidTokenIds.length > 0) {
      await prisma.pushToken.deleteMany({ where: { id: { in: invalidTokenIds } } });
    }

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...chunkTickets);
      } catch (error) {
        console.error('[expoPush] chunk send failed', error);
      }
    }

    // Clean up tokens reported as invalid by the Expo push service
    const badTokens: string[] = [];
    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'error') {
        const errorCode = (ticket.details as { error?: string } | undefined)?.error;
        if (errorCode === 'DeviceNotRegistered') {
          const failedToken = messages[idx]?.to;
          if (typeof failedToken === 'string') badTokens.push(failedToken);
        } else {
          console.warn('[expoPush] ticket error', ticket.message, ticket.details);
        }
      }
    });

    if (badTokens.length > 0) {
      await prisma.pushToken.deleteMany({ where: { token: { in: badTokens } } });
    }
  } catch (error) {
    console.error('[expoPush] sendExpoPushToUser failed', error);
  }
};
