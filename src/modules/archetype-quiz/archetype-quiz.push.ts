import { prisma } from '@/src/prisma/prisma';
import { sendExpoPushToUsers } from '@helper/expoPush';
import { getDueArchetypeQuizPush } from './archetype-quiz.schedule';

// A claim with no send time after this long belongs to a run that stopped mid-send.
const STALE_CLAIM_MS = 10 * 60 * 1000;

/** Creates the day's log row. False when another run already claimed it. */
const claimDay = async (date: string) => {
  try {
    await prisma.archetypeQuizPushLog.create({ data: { date } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return false;
    throw error;
  }
};

/** Deletes the day's claim, so the next run tries again. */
const releaseDay = (date: string) => prisma.archetypeQuizPushLog.delete({ where: { date } });

/**
 * Sends the due quiz push, if any, to creators with a device: all of them, or those who have
 * not finished the quiz. Safe to call every minute: only the first run that claims the date sends.
 */
export const sendArchetypeQuizPushForToday = async (now = new Date()) => {
  const push = getDueArchetypeQuizPush(now);
  if (!push) return { date: null, sent: false, recipients: 0 };

  const skipped = { date: push.date, sent: false, recipients: 0 };
  // A cheap read first, so the runs after a send do not hit the unique constraint.
  const existing = await prisma.archetypeQuizPushLog.findUnique({ where: { date: push.date } });
  if (existing) {
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
    if (existing.sentAt || existing.createdAt >= staleBefore) return skipped;
    // The run that claimed the day stopped before it finished. Creators it already reached
    // get the push again; that is better than nobody getting it.
    console.warn('[archetypeQuizPush] Retrying a send that did not finish:', push.date);
    await prisma.archetypeQuizPushLog.deleteMany({
      where: { date: push.date, sentAt: null, createdAt: { lt: staleBefore } },
    });
  }
  if (!(await claimDay(push.date))) return skipped;

  let userIds: string[];
  try {
    const creators = await prisma.user.findMany({
      where: {
        role: 'creator',
        status: { notIn: ['banned', 'blacklisted', 'suspended', 'spam'] },
        pushTokens: { some: {} },
        ...(push.audience === 'notCompleted'
          ? { OR: [{ archetypeQuiz: { is: null } }, { archetypeQuiz: { is: { completedAt: null } } }] }
          : {}),
      },
      select: { id: true },
    });
    userIds = creators.map((creator) => creator.id);
  } catch (error) {
    // Nothing was sent, so release the claim and let the next run try again.
    await releaseDay(push.date);
    throw error;
  }

  const result = await sendExpoPushToUsers(userIds, {
    title: push.title,
    body: push.body,
    data: { entity: 'ArchetypeQuiz' },
  });

  // Expo took none of it (an outage, or the send stopped early): try again next run.
  if (!result.accepted && (result.failed || result.messages > 0)) {
    await releaseDay(push.date);
    throw new Error(`Archetype quiz push ${push.date} was not accepted by Expo; retrying next run.`);
  }
  if (result.accepted < result.messages) {
    console.error('[archetypeQuizPush] Expo did not accept every push:', {
      date: push.date,
      accepted: result.accepted,
      messages: result.messages,
    });
  }

  await prisma.archetypeQuizPushLog.update({
    where: { date: push.date },
    data: { recipients: userIds.length, sentAt: new Date() },
  });

  return { date: push.date, sent: true, recipients: userIds.length };
};
