import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kuala_Lumpur';

export interface ArchetypeQuizPush {
  date: string; // YYYY-MM-DD in MYT
  time: string; // HH:mm in MYT
  audience: 'all' | 'notCompleted';
  title: string;
  body: string;
}

// A push missed while the server was down still goes out within this window.
const CATCH_UP_HOURS = 3;

export const ARCHETYPE_QUIZ_PUSHES: ArchetypeQuizPush[] = [
  {
    date: '2026-10-31',
    time: '10:30',
    audience: 'all',
    title: "LOL, you're such a control freak!",
    body: 'Find out which creator type you are. Take the quiz and face the truth.',
  },
  {
    date: '2026-11-03',
    time: '15:00',
    audience: 'notCompleted',
    title: 'Be soooo fr rn 🙄',
    body: 'Your choices say more about you than you think. Take the quiz to find out more.',
  },
  {
    date: '2026-11-06',
    time: '20:00',
    audience: 'notCompleted',
    title: "Omg you're such a gemini 👯‍♀️",
    body: "Or maybe you're just a walking Pinterest board. Take the quiz to find out.",
  },
  {
    date: '2026-11-09',
    time: '10:30',
    audience: 'notCompleted',
    title: "It's giving main character 💅",
    body: 'Instead of taking selfies, maybe you should take this quiz.',
  },
  {
    date: '2026-11-12',
    time: '20:00',
    audience: 'notCompleted',
    title: 'Wait… is this quiz about us? 🌚🌝',
    body: 'Check it out for yourself.',
  },
  {
    date: '2026-11-14',
    time: '12:00',
    audience: 'notCompleted',
    title: 'Have you seen this yet? 🤨',
    body: 'You might wanna send this to the group chat.',
  },
  {
    date: '2026-11-15',
    time: '15:00',
    audience: 'notCompleted',
    title: 'Hey, we need to talk.',
    body: 'Find out which personality type is responsible for your behaviour.',
  },
];

const sendTimeOf = (push: ArchetypeQuizPush) => dayjs.tz(`${push.date} ${push.time}`, TZ);

/** The quiz opens with the launch push. */
export const ARCHETYPE_QUIZ_LAUNCH_AT = sendTimeOf(ARCHETYPE_QUIZ_PUSHES[0]).toDate();

/**
 * Production keeps the quiz closed until launch. Other environments are always open, and
 * ARCHETYPE_QUIZ_EARLY_ACCESS=true opens it early on a production build (for example staging).
 */
export const isArchetypeQuizOpen = (now: Date) =>
  now >= ARCHETYPE_QUIZ_LAUNCH_AT ||
  process.env.NODE_ENV !== 'production' ||
  process.env.ARCHETYPE_QUIZ_EARLY_ACCESS === 'true';

/** The push whose send time has passed, while it is still inside its catch-up window. */
export const getDueArchetypeQuizPush = (now: Date) =>
  ARCHETYPE_QUIZ_PUSHES.find((push) => {
    const sendAt = sendTimeOf(push);
    return !dayjs(now).isBefore(sendAt) && dayjs(now).isBefore(sendAt.add(CATCH_UP_HOURS, 'hour'));
  }) ?? null;

/**
 * Start of the quiz prompt period that `now` falls in. A period starts at MYT midnight, and again
 * at a push's send time, so the prompt can show once a day plus once after each push.
 */
export const getPromptPeriodStart = (now: Date) => {
  const today = dayjs(now).tz(TZ);
  const pushToday = ARCHETYPE_QUIZ_PUSHES.find((push) => push.date === today.format('YYYY-MM-DD'));
  const pushAt = pushToday ? sendTimeOf(pushToday) : null;
  return pushAt && !today.isBefore(pushAt) ? pushAt.toDate() : today.startOf('day').toDate();
};
