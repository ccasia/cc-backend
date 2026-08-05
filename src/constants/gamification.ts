import { XpSourceType } from '@prisma/client';

export type RankId = 'riser' | 'breakout' | 'trendsetter' | 'headliner' | 'cultural';

export type RankDefinition = {
  id: RankId;
  name: string;
  minXp: number;
};

export const RANKS: readonly RankDefinition[] = [
  { id: 'riser', name: 'Riser', minXp: 0 },
  { id: 'breakout', name: 'Breakout', minXp: 1_000 },
  { id: 'trendsetter', name: 'Trendsetter', minXp: 5_000 },
  { id: 'headliner', name: 'Headliner', minXp: 14_000 },
  { id: 'cultural', name: 'Cultural', minXp: 40_000 },
];

export const GAMIFICATION_XP: Record<XpSourceType, number | null> = {
  HUNT_LOCATION_CLAIM: null,
  PITCH_SUBMITTED: 10,
  PITCH_APPROVED: 50,
  SHORTLISTED: 50,
  SUBMISSION_SUBMITTED: 75,
  SUBMISSION_APPROVED: 150,
  POSTING_SUBMITTED: 25,
  POSTING_APPROVED: 100,
  CLIENT_RATING: null,
  MEDIA_KIT_CONNECTED: 100,
  LEADERBOARD_TOP_10: 250,
  LEADERBOARD_TOP_3: 500,
  WEEKLY_TASK: 50,
  ACHIEVEMENT: null,
};

export const getRatingXp = (rating: number): number => {
  if (rating >= 5) return 150;
  if (rating === 4) return 100;
  return 0;
};

export const XP_BY_RARITY: Record<string, number> = {
  common: 25,
  uncommon: 75,
  rare: 100,
  legendary: 200,
  secret: 50,
};

export const getRankForXp = (totalXp: number): RankDefinition => {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (totalXp >= rank.minXp) current = rank;
  }
  return current;
};

export const getNextRank = (rankId: string): RankDefinition | null => {
  const index = RANKS.findIndex((rank) => rank.id === rankId);
  return index >= 0 ? (RANKS[index + 1] ?? null) : null;
};

/**
 * Leaderboard/history period id (`YYYY-MM`) in Asia/Kuala_Lumpur — fixed UTC+8,
 * no DST. Single source of truth for where a month boundary sits: any SQL that
 * buckets XP by month must use the same offset or the two will disagree for
 * claims made late on the last day of a month.
 */
export const getPeriodId = (at: Date = new Date()): string =>
  new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
