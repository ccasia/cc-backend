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
        attemptCount: 0,
        completedAt: null,
        promptDismissedAt: null,
        ...create,
      };
    return { ...row };
  });
  db.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (!row || (where.promptDismissedAt === null && row.promptDismissedAt !== null)) return { count: 0 };
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

describe('quiz state', () => {
  it('is NOT_STARTED when there is no row', async () => {
    expect(await getState('user-1')).toEqual({
      status: 'NOT_STARTED',
      archetype: null,
      mix: [],
      completedAt: null,
      attemptCount: 0,
      quizVersion: 1,
    });
  });

  it('retake overwrites the result and increments attemptCount', async () => {
    const first = await submit('user-1', body('mc', 'mc', 'mc', 'yap', 'cf'));
    expect(first).toMatchObject({ status: 'COMPLETED', archetype: 'MAIN_CHARACTER', attemptCount: 1 });
    expect(db.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          archetype: 'MAIN_CHARACTER',
          attemptCount: 1,
          quizVersion: 1,
        }),
        update: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );

    const second = await submit('user-1', body('th', 'th', 'th', 'yap', 'cf'));
    expect(second).toMatchObject({ status: 'COMPLETED', archetype: 'TREND_HOPPER', attemptCount: 2 });
    expect(second.mix[0]).toEqual({ archetype: 'TREND_HOPPER', percent: 60 });
    expect(typeof second.completedAt).toBe('string');
  });

  it('dismissing twice keeps the first timestamp', async () => {
    const first = await dismissPrompt('user-1');
    expect(first.status).toBe('DISMISSED');
    const firstAt = row?.promptDismissedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await dismissPrompt('user-1');
    expect(second.status).toBe('DISMISSED');
    expect(row?.promptDismissedAt).toBe(firstAt);
  });

  it('sets promptDismissedAt on an existing row without one, and keeps the result', async () => {
    await submit('user-1', body('cf', 'cf', 'cf', 'yap', 'mc'));
    const state = await dismissPrompt('user-1');
    expect(row?.promptDismissedAt).toBeInstanceOf(Date);
    expect(state).toMatchObject({ status: 'COMPLETED', archetype: 'CONTROL_FREAK', attemptCount: 1 });
  });

  it('stays COMPLETED when the prompt was dismissed before completing', async () => {
    await dismissPrompt('user-1');
    const state = await submit('user-1', body('pfb', 'pfb', 'pfb', 'yap', 'mc'));
    expect(state.status).toBe('COMPLETED');
    expect((await dismissPrompt('user-1')).status).toBe('COMPLETED');
  });
});
