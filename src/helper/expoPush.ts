import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '@/src/prisma/prisma';

const expo = new Expo();

interface ExpoPushPayload {
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  collapseId?: string; // for stacking notifications
}

export const sendExpoPushToUser = (userId: string, payload: ExpoPushPayload) => sendExpoPushToUsers([userId], payload);

export const sendExpoPushToUsers = async (userIds: string[], payload: ExpoPushPayload) => {
  if (userIds.length === 0) return;

  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
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

    // Clean up tokens reported as invalid by the Expo push service. Tickets are
    // matched per chunk so a failed chunk cannot shift the index of later ones.
    const badTokens: string[] = [];

    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, idx) => {
          if (ticket.status !== 'error') return;
          const errorCode = (ticket.details as { error?: string } | undefined)?.error;
          const failedToken = chunk[idx]?.to;
          if (errorCode === 'DeviceNotRegistered' && typeof failedToken === 'string') {
            badTokens.push(failedToken);
          } else {
            console.warn('[expoPush] ticket error', ticket.message, ticket.details);
          }
        });
      } catch (error) {
        console.error('[expoPush] chunk send failed', error);
      }
    }

    if (badTokens.length > 0) {
      await prisma.pushToken.deleteMany({ where: { token: { in: badTokens } } });
    }
  } catch (error) {
    console.error('[expoPush] sendExpoPushToUsers failed', error);
  }
};
