import { CreatorArchetype, CreatorArchetypeQuiz } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import {
  ARCHETYPE_ORDER,
  OPTION_TO_ARCHETYPE,
  QUESTION_IDS,
  QUIZ_VERSION,
  TIE_BREAK_QUESTION,
} from './archetype-quiz.definition';
import {
  ArchetypeMixRow,
  ArchetypeQuizState,
  ArchetypeScores,
  QuizAnswer,
  submitBodySchema,
} from './archetype-quiz.types';

export class ArchetypeQuizError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const emptyScores = (): ArchetypeScores =>
  Object.fromEntries(ARCHETYPE_ORDER.map((archetype) => [archetype, 0])) as ArchetypeScores;

export const buildMix = (scores: ArchetypeScores): ArchetypeMixRow[] =>
  ARCHETYPE_ORDER.map((archetype) => ({
    archetype,
    percent: Math.round((scores[archetype] / QUESTION_IDS.length) * 100),
  })).sort(
    (a, b) => b.percent - a.percent || ARCHETYPE_ORDER.indexOf(a.archetype) - ARCHETYPE_ORDER.indexOf(b.archetype),
  );

/** Pure. Expects answers that already passed `submitBodySchema`. */
export const scoreAnswers = (answers: QuizAnswer[]) => {
  const scores = emptyScores();
  for (const { questionId, optionId } of answers) {
    scores[OPTION_TO_ARCHETYPE[questionId][optionId]] += 1;
  }

  const top = Math.max(...ARCHETYPE_ORDER.map((archetype) => scores[archetype]));
  const tied = ARCHETYPE_ORDER.filter((archetype) => scores[archetype] === top);

  const tieBreak = answers.find((answer) => answer.questionId === TIE_BREAK_QUESTION);
  const tieBreakArchetype = tieBreak ? OPTION_TO_ARCHETYPE[tieBreak.questionId][tieBreak.optionId] : undefined;

  const archetype: CreatorArchetype =
    tieBreakArchetype && tied.includes(tieBreakArchetype) ? tieBreakArchetype : tied[0];

  return { archetype, scores, mix: buildMix(scores) };
};

const readScores = (value: unknown): ArchetypeScores => {
  const scores = emptyScores();
  if (!value || typeof value !== 'object') return scores;

  const stored = value as Record<string, unknown>;
  for (const archetype of ARCHETYPE_ORDER) {
    const count = Number(stored[archetype]);
    scores[archetype] = Number.isFinite(count) ? count : 0;
  }
  return scores;
};

export const toState = (row: CreatorArchetypeQuiz | null): ArchetypeQuizState => {
  const archetype = row?.archetype ?? null;
  const status = archetype ? 'COMPLETED' : row?.promptDismissedAt ? 'DISMISSED' : 'NOT_STARTED';

  return {
    status,
    archetype,
    mix: archetype ? buildMix(readScores(row?.scores)) : [],
    completedAt: row?.completedAt ? row.completedAt.toISOString() : null,
    attemptCount: row?.attemptCount ?? 0,
    quizVersion: QUIZ_VERSION,
  };
};

export const getState = async (userId: string): Promise<ArchetypeQuizState> => {
  const row = await prisma.creatorArchetypeQuiz.findUnique({ where: { userId } });
  return toState(row);
};

export const submit = async (userId: string, body: unknown): Promise<ArchetypeQuizState> => {
  const parsed = submitBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ArchetypeQuizError(400, parsed.error.issues[0]?.message ?? 'Invalid quiz answers');
  }

  const { quizVersion, answers } = parsed.data;
  const { archetype, scores } = scoreAnswers(answers);
  const result = { archetype, answers, scores, quizVersion, completedAt: new Date() };

  const row = await prisma.creatorArchetypeQuiz.upsert({
    where: { userId },
    create: { userId, ...result, attemptCount: 1 },
    update: { ...result, attemptCount: { increment: 1 } },
  });

  return toState(row);
};

export const dismissPrompt = async (userId: string): Promise<ArchetypeQuizState> => {
  const now = new Date();

  const row = await prisma.creatorArchetypeQuiz.upsert({
    where: { userId },
    create: { userId, promptDismissedAt: now },
    update: {},
  });
  if (row.promptDismissedAt) return toState(row);

  await prisma.creatorArchetypeQuiz.updateMany({
    where: { userId, promptDismissedAt: null },
    data: { promptDismissedAt: now },
  });

  return getState(userId);
};
