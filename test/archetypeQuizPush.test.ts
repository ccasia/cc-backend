jest.mock('../src/prisma/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    archetypeQuizPushLog: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));
jest.mock('../src/helper/expoPush', () => ({ sendExpoPushToUsers: jest.fn() }));

import { prisma } from '../src/prisma/prisma';
import { sendExpoPushToUsers } from '../src/helper/expoPush';
import {
  ARCHETYPE_QUIZ_PUSHES,
  getArchetypeQuizPushFor,
  sendArchetypeQuizPushForToday,
} from '../src/modules/archetype-quiz/archetype-quiz.push';

const findMany = (prisma as any).user.findMany as jest.Mock;
const log = (prisma as any).archetypeQuizPushLog as Record<'create' | 'update' | 'delete', jest.Mock>;
const send = sendExpoPushToUsers as jest.Mock;

const LAUNCH_9AM = new Date('2026-10-31T01:00:00Z');

describe('archetype quiz push schedule', () => {
  it('has the 7 agreed dates in order', () => {
    expect(ARCHETYPE_QUIZ_PUSHES.map((push) => push.date)).toEqual([
      '2026-10-31',
      '2026-11-03',
      '2026-11-06',
      '2026-11-09',
      '2026-11-12',
      '2026-11-14',
      '2026-11-15',
    ]);
  });

  it('matches the date in MYT, not UTC', () => {
    // 09:00 MYT on 31 Oct is 01:00 UTC on 31 Oct.
    expect(getArchetypeQuizPushFor(LAUNCH_9AM)?.date).toBe('2026-10-31');
    // 00:30 MYT on 3 Nov is still 2 Nov in UTC.
    expect(getArchetypeQuizPushFor(new Date('2026-11-02T16:30:00Z'))?.date).toBe('2026-11-03');
    expect(getArchetypeQuizPushFor(new Date('2026-11-01T01:00:00Z'))).toBeNull();
  });
});

describe('sendArchetypeQuizPushForToday', () => {
  it('does nothing on a day with no push', async () => {
    const result = await sendArchetypeQuizPushForToday(new Date('2026-11-01T01:00:00Z'));

    expect(result).toEqual({ date: null, sent: false, recipients: 0 });
    expect(log.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('claims the day, sends to creators who have not finished the quiz, then logs it', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

    const result = await sendArchetypeQuizPushForToday(LAUNCH_9AM);

    expect(result).toEqual({ date: '2026-10-31', sent: true, recipients: 2 });
    expect(log.create).toHaveBeenCalledWith({ data: { date: '2026-10-31' } });
    expect(findMany.mock.calls[0][0].where).toEqual({
      role: 'creator',
      status: { notIn: ['banned', 'blacklisted', 'suspended', 'spam'] },
      pushTokens: { some: {} },
      OR: [{ archetypeQuiz: { is: null } }, { archetypeQuiz: { is: { completedAt: null } } }],
    });
    expect(send).toHaveBeenCalledWith(['u1', 'u2'], {
      title: "LOL, you're such a control freak!",
      body: 'Find out which creator type you are. Take the quiz and face the truth.',
      data: { entity: 'ArchetypeQuiz' },
    });
    expect(log.update).toHaveBeenCalledWith({
      where: { date: '2026-10-31' },
      data: { recipients: 2, sentAt: expect.any(Date) },
    });
  });

  it('skips when an earlier run already claimed the day', async () => {
    log.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const result = await sendArchetypeQuizPushForToday(LAUNCH_9AM);

    expect(result).toEqual({ date: '2026-10-31', sent: false, recipients: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('releases the claim when the creator query fails, so the next run retries', async () => {
    log.create.mockResolvedValue({});
    findMany.mockRejectedValue(new Error('db down'));

    await expect(sendArchetypeQuizPushForToday(LAUNCH_9AM)).rejects.toThrow('db down');

    expect(log.delete).toHaveBeenCalledWith({ where: { date: '2026-10-31' } });
    expect(send).not.toHaveBeenCalled();
    expect(log.update).not.toHaveBeenCalled();
  });

  it('rethrows other claim errors without sending', async () => {
    log.create.mockRejectedValue(new Error('connection lost'));

    await expect(sendArchetypeQuizPushForToday(LAUNCH_9AM)).rejects.toThrow('connection lost');
    expect(send).not.toHaveBeenCalled();
  });
});
