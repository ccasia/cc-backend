jest.mock('../src/prisma/prisma', () => ({
  prisma: {
    creatorArchetypeQuiz: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  },
}));

import { prisma } from '../src/prisma/prisma';
import {
  ArchetypeQuizError,
  dismissPrompt,
  getState,
  scoreAnswers,
  submit,
} from '../src/modules/archetype-quiz/archetype-quiz.service';

const db = (prisma as any).creatorArchetypeQuiz;

// In-memory stand-in for the single CreatorArchetypeQuiz row of one user.
let row: Record<string, any> | null = null;

const applyData = (target: Record<string, any>, data: Record<string, any>) => {
  for (const [key, value] of Object.entries(data)) {
    target[key] = value && typeof value === 'object' && 'increment' in value ? target[key] + value.increment : value;
  }
};

beforeEach(() => {
  row = null;
  db.findUnique.mockImplementation(async () => (row ? { ...row } : null));
  db.upsert.mockImplementation(async ({ create, update }: any) => {
    if (row) applyData(row, update);
    else
      row = {
        id: 'quiz-1',
        archetype: null,
        answers: null,
        scores: null,
        quizVersion: null,
        completedAt: null,
        promptDismissedAt: null,
        ...create,
      };
    return { ...row };
  });
  db.updateMany.mockImplementation(async ({ where, data }: any) => {
    const { userId: _userId, ...filters } = where;
    const matches = Object.entries(filters).every(([key, value]) => (value === null ? row?.[key] === null : true));
    if (!row || !matches) return { count: 0 };
    applyData(row, data);
    return { count: 1 };
  });
});

const answersOf = (...shorts: string[]) =>
  shorts.map((short, i) => ({ questionId: `q${i + 1}`, optionId: `q${i + 1}_${short}` }));
const body = (...shorts: string[]) => ({ quizVersion: 1, answers: answersOf(...shorts) });

describe('scoreAnswers', () => {
  it('picks the clear winner', () => {
    const result = scoreAnswers(answersOf('yap', 'yap', 'yap', 'mc', 'cf') as any);
    expect(result.archetype).toBe('YAPPER');
    expect(result.scores).toEqual({
      MAIN_CHARACTER: 1,
      PINTEREST_FINAL_BOSS: 0,
      YAPPER: 3,
      TREND_HOPPER: 0,
      CONTROL_FREAK: 1,
    });
  });

  it('breaks a tie with the q5 archetype when it is among the tied', () => {
    expect(scoreAnswers(answersOf('mc', 'mc', 'cf', 'cf', 'cf') as any).archetype).toBe('CONTROL_FREAK');
    expect(scoreAnswers(answersOf('mc', 'cf', 'cf', 'th', 'mc') as any).archetype).toBe('MAIN_CHARACTER');
  });

  it('falls back to archetype order when q5 is not among the tied', () => {
    expect(scoreAnswers(answersOf('cf', 'cf', 'pfb', 'pfb', 'th') as any).archetype).toBe('PINTEREST_FINAL_BOSS');
  });

  it('uses q5 on a 1/1/1/1/1 split', () => {
    expect(scoreAnswers(answersOf('mc', 'pfb', 'yap', 'cf', 'th') as any).archetype).toBe('TREND_HOPPER');
  });

  it('builds a mix that sums to 100, sorted by percent then archetype order', () => {
    const { mix } = scoreAnswers(answersOf('cf', 'cf', 'yap', 'mc', 'th') as any);
    expect(mix.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
    expect(mix).toEqual([
      { archetype: 'CONTROL_FREAK', percent: 40 },
      { archetype: 'MAIN_CHARACTER', percent: 20 },
      { archetype: 'YAPPER', percent: 20 },
      { archetype: 'TREND_HOPPER', percent: 20 },
      { archetype: 'PINTEREST_FINAL_BOSS', percent: 0 },
    ]);
  });
});

describe('submit validation', () => {
  const rejects = async (input: unknown) => {
    const error = await submit('user-1', input).catch((e) => e);
    expect(error).toBeInstanceOf(ArchetypeQuizError);
    expect(error.status).toBe(400);
    expect(db.upsert).not.toHaveBeenCalled();
  };

  it('rejects a wrong quizVersion', () => rejects({ ...body('mc', 'mc', 'mc', 'mc', 'mc'), quizVersion: 2 }));

  it('rejects 4 answers', () => rejects({ quizVersion: 1, answers: answersOf('mc', 'mc', 'mc', 'mc') }));

  it('rejects a duplicate questionId', () => {
    const answers = answersOf('mc', 'mc', 'mc', 'mc', 'mc');
    answers[4] = { questionId: 'q1', optionId: 'q1_cf' };
    return rejects({ quizVersion: 1, answers });
  });

  it('rejects an option from another question', () => {
    const answers = answersOf('mc', 'mc', 'mc', 'mc', 'mc');
    answers[1] = { questionId: 'q2', optionId: 'q1_mc' };
    return rejects({ quizVersion: 1, answers });
  });
});

// 3 Nov 2026 has a 15:00 MYT push (07:00 UTC), so its second prompt period starts then.
const NOV3_MIDNIGHT = '2026-11-02T16:00:00.000Z';
const NOV3_PUSH = '2026-11-03T07:00:00.000Z';

describe('quiz state', () => {
  afterEach(() => jest.useRealTimers());

  const at = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: ['setTimeout'] });

  it('is NOT_STARTED with the prompt due when there is no row', async () => {
    at('2026-11-03T02:00:00Z');
    expect(await getState('user-1')).toEqual({
      status: 'NOT_STARTED',
      archetype: null,
      mix: [],
      completedAt: null,
      promptSlot: NOV3_MIDNIGHT,
      quizVersion: 1,
    });
  });

  it('keeps the first result: a second submit does not overwrite it', async () => {
    const first = await submit('user-1', body('mc', 'mc', 'mc', 'yap', 'cf'));
    expect(first).toMatchObject({ status: 'COMPLETED', archetype: 'MAIN_CHARACTER', promptSlot: null });

    const second = await submit('user-1', body('th', 'th', 'th', 'yap', 'cf'));
    expect(second).toMatchObject({ status: 'COMPLETED', archetype: 'MAIN_CHARACTER' });
    expect(second.mix[0]).toEqual({ archetype: 'MAIN_CHARACTER', percent: 60 });
    expect(typeof second.completedAt).toBe('string');
  });

  it('hides the prompt for the rest of the day after a dismiss', async () => {
    at('2026-11-01T02:00:00Z'); // 10:00 MYT, no push that day
    expect((await dismissPrompt('user-1')).promptSlot).toBeNull();

    at('2026-11-01T15:59:00Z'); // 23:59 MYT
    expect((await getState('user-1')).promptSlot).toBeNull();
  });

  it('shows the prompt again on the next MYT day', async () => {
    at('2026-11-01T15:00:00Z'); // 23:00 MYT on 1 Nov
    await dismissPrompt('user-1');

    at('2026-11-01T16:00:00Z'); // 00:00 MYT on 2 Nov
    expect(await getState('user-1')).toMatchObject({
      status: 'DISMISSED',
      promptSlot: '2026-11-01T16:00:00.000Z',
    });
  });

  it('shows the prompt again after the push on a push day', async () => {
    at('2026-11-03T01:00:00Z'); // 09:00 MYT
    await dismissPrompt('user-1');

    at('2026-11-03T06:59:00Z'); // 14:59 MYT, just before the 15:00 push
    expect((await getState('user-1')).promptSlot).toBeNull();

    at(NOV3_PUSH);
    expect((await getState('user-1')).promptSlot).toBe(NOV3_PUSH);

    await dismissPrompt('user-1');
    at('2026-11-03T15:00:00Z'); // 23:00 MYT
    expect((await getState('user-1')).promptSlot).toBeNull();
  });

  it('moves the dismiss time forward on each dismiss', async () => {
    await dismissPrompt('user-1');
    const firstAt = row?.promptDismissedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await dismissPrompt('user-1');
    expect(row?.promptDismissedAt.getTime()).toBeGreaterThan(firstAt.getTime());
  });

  it('never shows the prompt once the quiz is completed', async () => {
    await dismissPrompt('user-1');
    const state = await submit('user-1', body('pfb', 'pfb', 'pfb', 'yap', 'mc'));
    expect(state).toMatchObject({ status: 'COMPLETED', promptSlot: null });
    expect(await dismissPrompt('user-1')).toMatchObject({ status: 'COMPLETED', promptSlot: null });
  });
});
