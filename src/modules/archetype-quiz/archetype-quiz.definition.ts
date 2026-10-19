import { CreatorArchetype } from '@prisma/client';

export const QUIZ_VERSION = 1;

export const ARCHETYPE_ORDER: CreatorArchetype[] = [
  'MAIN_CHARACTER',
  'PINTEREST_FINAL_BOSS',
  'YAPPER',
  'TREND_HOPPER',
  'CONTROL_FREAK',
];

const SHORT_TO_ARCHETYPE: Record<string, CreatorArchetype> = {
  mc: 'MAIN_CHARACTER',
  pfb: 'PINTEREST_FINAL_BOSS',
  yap: 'YAPPER',
  th: 'TREND_HOPPER',
  cf: 'CONTROL_FREAK',
};

export const QUESTION_IDS = ['q1', 'q2', 'q3', 'q4', 'q5'] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export const TIE_BREAK_QUESTION: QuestionId = 'q5';

/** questionId → optionId → archetype. Option ids are `${questionId}_${short}`. */
export const OPTION_TO_ARCHETYPE: Record<QuestionId, Record<string, CreatorArchetype>> = Object.fromEntries(
  QUESTION_IDS.map((questionId) => [
    questionId,
    Object.fromEntries(
      Object.entries(SHORT_TO_ARCHETYPE).map(([short, archetype]) => [`${questionId}_${short}`, archetype]),
    ),
  ]),
) as Record<QuestionId, Record<string, CreatorArchetype>>;
