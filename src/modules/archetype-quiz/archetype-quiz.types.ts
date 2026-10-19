import { CreatorArchetype } from '@prisma/client';
import { z } from 'zod';
import { OPTION_TO_ARCHETYPE, QUESTION_IDS, QUIZ_VERSION } from './archetype-quiz.definition';

export type ArchetypeQuizStatus = 'NOT_STARTED' | 'DISMISSED' | 'COMPLETED';

export interface ArchetypeMixRow {
  archetype: CreatorArchetype;
  percent: number;
}

export interface ArchetypeQuizState {
  status: ArchetypeQuizStatus;
  archetype: CreatorArchetype | null;
  mix: ArchetypeMixRow[];
  completedAt: string | null;
  attemptCount: number;
  quizVersion: number;
}

export type ArchetypeScores = Record<CreatorArchetype, number>;

const isOptionOf = (questionId: string, optionId: string) => {
  const options = OPTION_TO_ARCHETYPE[questionId as keyof typeof OPTION_TO_ARCHETYPE];
  return !!options && Object.prototype.hasOwnProperty.call(options, optionId);
};

const answerSchema = z
  .object({
    questionId: z.enum(QUESTION_IDS),
    optionId: z.string(),
  })
  .refine((answer) => isOptionOf(answer.questionId, answer.optionId), {
    message: 'Option does not belong to its question',
    path: ['optionId'],
  });

export const submitBodySchema = z.object({
  quizVersion: z.literal(QUIZ_VERSION, { error: 'Quiz version is out of date' }),
  answers: z
    .array(answerSchema)
    .length(QUESTION_IDS.length, { error: `Answer all ${QUESTION_IDS.length} questions` })
    .refine((answers) => new Set(answers.map((a) => a.questionId)).size === answers.length, {
      message: 'Each question must be answered once',
    }),
});

export type SubmitBody = z.infer<typeof submitBodySchema>;

export type QuizAnswer = SubmitBody['answers'][number];
