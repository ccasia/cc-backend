/**
 * Sends the archetype quiz pushes to ONE account, to check them on a real phone.
 *
 * Safe by design:
 *  - It sends only to the account with the given email, never to the campaign audience.
 *  - It does not write the push log, so the real scheduled sends are not affected.
 *  - It refuses to run when NODE_ENV is production.
 *
 * For each push it first checks that the schedule makes that push due at its MYT send time,
 * then sends the exact title, body and tap data the cron job sends.
 *
 * Usage (push number 1-7, or "all"; default "all"):
 *   docker exec -w /app cc-backend npx tsx src/scripts/testArchetypeQuizPush.ts you@example.com
 *   docker exec -w /app cc-backend npx tsx src/scripts/testArchetypeQuizPush.ts you@example.com 3
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { prisma } from '@/src/prisma/prisma';
import { sendExpoPushToUsers } from '@helper/expoPush';
import { ARCHETYPE_QUIZ_PUSHES, getDueArchetypeQuizPush } from '../modules/archetype-quiz/archetype-quiz.schedule';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kuala_Lumpur';
const GAP_MS = 4000;

const main = async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Do not run this in production.');

  const [email, which = 'all'] = process.argv.slice(2);
  if (!email) throw new Error('Give the email of the account to send to.');

  const numbers = which === 'all' ? ARCHETYPE_QUIZ_PUSHES.map((_, i) => i + 1) : [Number(which)];
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > ARCHETYPE_QUIZ_PUSHES.length)) {
    throw new Error(`Push number must be 1-${ARCHETYPE_QUIZ_PUSHES.length} or "all".`);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, _count: { select: { pushTokens: true } } },
  });
  if (!user) throw new Error(`No account with email ${email}.`);
  if (!user._count.pushTokens) {
    throw new Error('This account has no push token. Log in on the phone and allow notifications first.');
  }
  console.log(`Sending to 1 account with ${user._count.pushTokens} device token(s).\n`);

  for (const [index, n] of numbers.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    const push = ARCHETYPE_QUIZ_PUSHES[n - 1];
    const sendAt = dayjs.tz(`${push.date} ${push.time}`, TZ);
    const dueAtSendTime = getDueArchetypeQuizPush(sendAt.toDate()) === push;
    const dueMinuteBefore = getDueArchetypeQuizPush(sendAt.subtract(1, 'minute').toDate()) === push;

    console.log(
      `#${n} ${sendAt.format('ddd D MMM YYYY, HH:mm')} MYT (${sendAt.utc().format('HH:mm')} UTC), ${push.audience}`,
    );
    console.log(`   schedule check: ${dueAtSendTime && !dueMinuteBefore ? 'OK' : 'WRONG'}`);
    console.log(`   "${push.title}" / "${push.body}"`);

    await sendExpoPushToUsers([user.id], {
      title: push.title,
      body: push.body,
      data: { entity: 'ArchetypeQuiz' },
    });
    console.log('   sent\n');
  }
};

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
