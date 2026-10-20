import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { prisma } from '@/src/prisma/prisma';
import { sendExpoPushToUsers } from '@helper/expoPush';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kuala_Lumpur';

export interface ArchetypeQuizPush {
  date: string; // YYYY-MM-DD in MYT
  title: string;
  body: string;
}

export const ARCHETYPE_QUIZ_PUSHES: ArchetypeQuizPush[] = [
  {
    date: '2026-10-31',
    title: "LOL, you're such a control freak!",
    body: 'Find out which creator type you are. Take the quiz and face the truth.',
  },
  {
    date: '2026-11-03',
    title: 'Be soooo fr rn 🙄',
    body: 'Your choices say more about you than you think. Take the quiz to find out more.',
  },
  {
    date: '2026-11-06',
    title: "Omg you're such a gemini 👯‍♀️",
    body: "Or maybe you're just a walking Pinterest board. Take the quiz to find out.",
  },
  {
    date: '2026-11-09',
    title: "It's giving main character 💅",
    body: 'Instead of taking selfies, maybe you should take this quiz.',
  },
  {
    date: '2026-11-12',
    title: 'Wait… is this quiz about us? 🌚🌝',
    body: 'Check it out for yourself.',
  },
  {
    date: '2026-11-14',
    title: 'Have you seen this yet? 🤨',
    body: 'You might wanna send this to the groupchat.',
  },
  {
    date: '2026-11-15',
    title: 'Hey, we need to talk.',
    body: 'Find out which personality type is responsible for your behaviour.',
  },
];

export const getArchetypeQuizPushFor = (now: Date) => {
  const today = dayjs(now).tz(TZ).format('YYYY-MM-DD');
  return ARCHETYPE_QUIZ_PUSHES.find((push) => push.date === today) ?? null;
};

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

/**
 * Sends today's quiz push, if any, to creators with a device who have not finished the quiz.
 * Safe to call many times a day: only the first run that claims the date sends.
 */
export const sendArchetypeQuizPushForToday = async (now = new Date()) => {
  const push = getArchetypeQuizPushFor(now);
  if (!push) return { date: null, sent: false, recipients: 0 };

  if (!(await claimDay(push.date))) return { date: push.date, sent: false, recipients: 0 };

  let userIds: string[];
  try {
    const creators = await prisma.user.findMany({
      where: {
        role: 'creator',
        status: { notIn: ['banned', 'blacklisted', 'suspended', 'spam'] },
        pushTokens: { some: {} },
        OR: [{ archetypeQuiz: { is: null } }, { archetypeQuiz: { is: { completedAt: null } } }],
      },
      select: { id: true },
    });
    userIds = creators.map((creator) => creator.id);
  } catch (error) {
    // Nothing was sent, so release the claim and let the next run try again.
    await prisma.archetypeQuizPushLog.delete({ where: { date: push.date } });
    throw error;
  }

  await sendExpoPushToUsers(userIds, {
    title: push.title,
    body: push.body,
    data: { entity: 'ArchetypeQuiz' },
  });

  await prisma.archetypeQuizPushLog.update({
    where: { date: push.date },
    data: { recipients: userIds.length, sentAt: new Date() },
  });

  return { date: push.date, sent: true, recipients: userIds.length };
};
