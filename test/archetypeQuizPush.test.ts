jest.mock('../src/prisma/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    archetypeQuizPushLog: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));
jest.mock('../src/helper/expoPush', () => ({ sendExpoPushToUsers: jest.fn() }));

import { prisma } from '../src/prisma/prisma';
import { sendExpoPushToUsers } from '../src/helper/expoPush';
import { requireOpenArchetypeQuiz } from '../src/modules/archetype-quiz/archetype-quiz.controller';
import { sendArchetypeQuizPushForToday } from '../src/modules/archetype-quiz/archetype-quiz.push';
import {
  ARCHETYPE_QUIZ_PUSHES,
  getDueArchetypeQuizPush,
  getPromptPeriodStart,
  isArchetypeQuizOpen,
} from '../src/modules/archetype-quiz/archetype-quiz.schedule';

const findMany = (prisma as any).user.findMany as jest.Mock;
const log = (prisma as any).archetypeQuizPushLog as Record<
  'findUnique' | 'create' | 'update' | 'delete' | 'deleteMany',
  jest.Mock
>;
const send = sendExpoPushToUsers as jest.Mock;

// 10:30 MYT on 31 Oct is 02:30 UTC.
const LAUNCH = new Date('2026-10-31T02:30:00Z');

describe('archetype quiz push schedule', () => {
  it('has the 7 agreed MYT send times and audiences, in order', () => {
    expect(ARCHETYPE_QUIZ_PUSHES.map(({ date, time, audience }) => `${date} ${time} ${audience}`)).toEqual([
      '2026-10-31 10:30 all',
      '2026-11-03 15:00 notCompleted',
      '2026-11-06 20:00 notCompleted',
      '2026-11-09 10:30 notCompleted',
      '2026-11-12 20:00 notCompleted',
      '2026-11-14 12:00 notCompleted',
      '2026-11-15 15:00 notCompleted',
    ]);
  });

  it('is due from its MYT send time, not before', () => {
    expect(getDueArchetypeQuizPush(new Date('2026-10-31T02:29:59Z'))).toBeNull();
    expect(getDueArchetypeQuizPush(LAUNCH)?.date).toBe('2026-10-31');
    // 20:00 MYT on 6 Nov is 12:00 UTC.
    expect(getDueArchetypeQuizPush(new Date('2026-11-06T11:59:00Z'))).toBeNull();
    expect(getDueArchetypeQuizPush(new Date('2026-11-06T12:00:00Z'))?.date).toBe('2026-11-06');
  });

  it('catches up for 3 hours after the send time, then gives up', () => {
    expect(getDueArchetypeQuizPush(new Date('2026-10-31T05:29:00Z'))?.date).toBe('2026-10-31');
    expect(getDueArchetypeQuizPush(new Date('2026-10-31T05:30:00Z'))).toBeNull();
  });

  it('is never due on a day without a push', () => {
    expect(getDueArchetypeQuizPush(new Date('2026-11-01T04:00:00Z'))).toBeNull();
  });
});

describe('isArchetypeQuizOpen', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('stays closed in production until the launch party, 17:00 MYT on 30 Oct', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ARCHETYPE_QUIZ_EARLY_ACCESS;
    expect(isArchetypeQuizOpen(new Date('2026-10-30T08:59:59Z'))).toBe(false);
    expect(isArchetypeQuizOpen(new Date('2026-10-30T09:00:00Z'))).toBe(true);
  });

  it('tells the app when the quiz opens in the 403', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ARCHETYPE_QUIZ_EARLY_ACCESS;
    jest.useFakeTimers().setSystemTime(new Date('2026-10-30T08:59:00Z'));
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as any;
    const next = jest.fn();

    requireOpenArchetypeQuiz({} as any, res, next);
    jest.useRealTimers();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ opensAt: '2026-10-30T09:00:00.000Z', now: '2026-10-30T08:59:00.000Z' }),
    );
  });

  it('opens early with ARCHETYPE_QUIZ_EARLY_ACCESS, and outside production', () => {
    const beforeLaunch = new Date('2026-10-27T00:00:00Z');
    process.env.NODE_ENV = 'production';
    process.env.ARCHETYPE_QUIZ_EARLY_ACCESS = 'true';
    expect(isArchetypeQuizOpen(beforeLaunch)).toBe(true);

    delete process.env.ARCHETYPE_QUIZ_EARLY_ACCESS;
    process.env.NODE_ENV = 'development';
    expect(isArchetypeQuizOpen(beforeLaunch)).toBe(true);
  });
});

describe('getPromptPeriodStart', () => {
  it('starts at MYT midnight on a day without a push', () => {
    // 01:00 MYT on 2 Nov is still 1 Nov in UTC.
    expect(getPromptPeriodStart(new Date('2026-11-01T17:00:00Z')).toISOString()).toBe('2026-11-01T16:00:00.000Z');
  });

  it('starts again at the push time on a push day', () => {
    // 12:00 MYT push on 14 Nov is 04:00 UTC.
    expect(getPromptPeriodStart(new Date('2026-11-14T03:59:00Z')).toISOString()).toBe('2026-11-13T16:00:00.000Z');
    expect(getPromptPeriodStart(new Date('2026-11-14T04:00:00Z')).toISOString()).toBe('2026-11-14T04:00:00.000Z');
    expect(getPromptPeriodStart(new Date('2026-11-14T15:59:00Z')).toISOString()).toBe('2026-11-14T04:00:00.000Z');
  });
});

describe('sendArchetypeQuizPushForToday', () => {
  beforeEach(() => {
    log.findUnique.mockResolvedValue(null);
    send.mockResolvedValue({ messages: 2, accepted: 2, failed: false });
  });

  it('does nothing when no push is due', async () => {
    const result = await sendArchetypeQuizPushForToday(new Date('2026-10-31T01:00:00Z'));

    expect(result).toEqual({ date: null, sent: false, recipients: 0 });
    expect(log.findUnique).not.toHaveBeenCalled();
    expect(log.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the launch push to every creator with a device, then logs it', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

    const result = await sendArchetypeQuizPushForToday(LAUNCH);

    expect(result).toEqual({ date: '2026-10-31', sent: true, recipients: 2 });
    expect(log.create).toHaveBeenCalledWith({ data: { date: '2026-10-31' } });
    expect(findMany.mock.calls[0][0].where).toEqual({
      role: 'creator',
      status: { notIn: ['banned', 'blacklisted', 'suspended', 'spam'] },
      pushTokens: { some: {} },
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

  it('sends a reminder only to creators who have not finished the quiz', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u3' }]);

    // 15:00 MYT on 3 Nov.
    const result = await sendArchetypeQuizPushForToday(new Date('2026-11-03T07:00:00Z'));

    expect(result).toEqual({ date: '2026-11-03', sent: true, recipients: 1 });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { archetypeQuiz: { is: null } },
      { archetypeQuiz: { is: { completedAt: null } } },
    ]);
    expect(send.mock.calls[0][1].title).toBe('Be soooo fr rn 🙄');
  });

  it('skips with a read when the day is already sent', async () => {
    log.findUnique.mockResolvedValue({ date: '2026-10-31', createdAt: LAUNCH, sentAt: LAUNCH });

    const result = await sendArchetypeQuizPushForToday(LAUNCH);

    expect(result).toEqual({ date: '2026-10-31', sent: false, recipients: 0 });
    expect(log.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('skips while another run is still sending', async () => {
    log.findUnique.mockResolvedValue({ date: '2026-10-31', createdAt: LAUNCH, sentAt: null });

    const result = await sendArchetypeQuizPushForToday(new Date(LAUNCH.getTime() + 5 * 60 * 1000));

    expect(result).toEqual({ date: '2026-10-31', sent: false, recipients: 0 });
    expect(log.deleteMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('retries a claim left unsent for 10 minutes, as after a crash mid-send', async () => {
    log.findUnique.mockResolvedValue({ date: '2026-10-31', createdAt: LAUNCH, sentAt: null });
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = new Date(LAUNCH.getTime() + 11 * 60 * 1000);

    const result = await sendArchetypeQuizPushForToday(now);

    expect(log.deleteMany).toHaveBeenCalledWith({
      where: { date: '2026-10-31', sentAt: null, createdAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } },
    });
    expect(result).toEqual({ date: '2026-10-31', sent: true, recipients: 2 });
  });

  it('releases the claim and throws when Expo accepts nothing, so the next run retries', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    send.mockResolvedValue({ messages: 2, accepted: 0, failed: false });

    await expect(sendArchetypeQuizPushForToday(LAUNCH)).rejects.toThrow('not accepted by Expo');

    expect(log.delete).toHaveBeenCalledWith({ where: { date: '2026-10-31' } });
    expect(log.update).not.toHaveBeenCalled();
  });

  it('releases the claim when the send stops on an error before Expo accepts any', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u1' }]);
    send.mockResolvedValue({ messages: 0, accepted: 0, failed: true });

    await expect(sendArchetypeQuizPushForToday(LAUNCH)).rejects.toThrow('not accepted by Expo');
    expect(log.delete).toHaveBeenCalled();
  });

  it('logs the day as sent when Expo accepts only part of it', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    send.mockResolvedValue({ messages: 2, accepted: 1, failed: false });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await sendArchetypeQuizPushForToday(LAUNCH);

    expect(result).toEqual({ date: '2026-10-31', sent: true, recipients: 2 });
    expect(log.delete).not.toHaveBeenCalled();
    expect(log.update).toHaveBeenCalled();
  });

  it('logs the day as sent when nobody has a valid token', async () => {
    log.create.mockResolvedValue({});
    findMany.mockResolvedValue([]);
    send.mockResolvedValue({ messages: 0, accepted: 0, failed: false });

    const result = await sendArchetypeQuizPushForToday(LAUNCH);

    expect(result).toEqual({ date: '2026-10-31', sent: true, recipients: 0 });
    expect(log.delete).not.toHaveBeenCalled();
  });

  it('skips when another run claims the day first', async () => {
    log.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const result = await sendArchetypeQuizPushForToday(LAUNCH);

    expect(result).toEqual({ date: '2026-10-31', sent: false, recipients: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('releases the claim when the creator query fails, so the next run retries', async () => {
    log.create.mockResolvedValue({});
    findMany.mockRejectedValue(new Error('db down'));

    await expect(sendArchetypeQuizPushForToday(LAUNCH)).rejects.toThrow('db down');

    expect(log.delete).toHaveBeenCalledWith({ where: { date: '2026-10-31' } });
    expect(send).not.toHaveBeenCalled();
    expect(log.update).not.toHaveBeenCalled();
  });

  it('rethrows other claim errors without sending', async () => {
    log.create.mockRejectedValue(new Error('connection lost'));

    await expect(sendArchetypeQuizPushForToday(LAUNCH)).rejects.toThrow('connection lost');
    expect(send).not.toHaveBeenCalled();
  });
});
