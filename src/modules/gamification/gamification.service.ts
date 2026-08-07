import { Rank, RewardType } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';

export type PointActionCode =
  | 'pitch_submitted'
  | 'pitch_approved'
  | 'shortlisted'
  | 'submission_submitted'
  | 'submission_approved'
  | 'posting_link_submitted'
  | 'posting_link_approved'
  | 'client_rating_4'
  | 'client_rating_5'
  | 'leaderboard_top_10'
  | 'leaderboard_top_3'
  | 'connecting_media_kit'
  | 'weekly_task'
  | 'achievement'
  | 'hunt_location_claim';

export interface PointActionRecord {
  id: string;
  code: string;
  name: string;
  points: number | null;
  rewardType: RewardType;
  isOneTime: boolean;
}

export interface CreatorPointsRecord {
  creatorId: string;
  totalPoints: number;
  currentRankId: string;
  currentRank: Rank;
  updatedAt: Date;
}

export interface RankProgress {
  currentRank: Rank;
  nextRank: Rank | null;
  pointsToNextRank: number | null;
}

export const getPointAction = async (code: PointActionCode | string): Promise<PointActionRecord | null> => {
  const action = await prisma.xpAction.findFirst({ where: { code } });
  if (!action) return null;

  return {
    id: action.id,
    code: action.code,
    name: action.name,
    points: action.points,
    rewardType: action.rewardType,
    isOneTime: action.rewardType === 'one_time',
  };
};

export const getCreatorPoints = async (creatorId: string): Promise<CreatorPointsRecord | null> => {
  const balance = await prisma.userXpBalance.findUnique({
    where: { userId: creatorId },
    include: { rank: true },
  });
  if (!balance) return null;

  return {
    creatorId: balance.userId,
    totalPoints: balance.total,
    currentRankId: balance.currentRankId,
    currentRank: balance.rank,
    updatedAt: balance.updatedAt,
  };
};

export const calculateNextRank = async (totalPoints: number): Promise<RankProgress> => {
  const ranks = await prisma.rank.findMany({ orderBy: { minPoints: 'asc' } });

  let currentRank = ranks[0];
  let nextRank: Rank | null = null;

  for (const rank of ranks) {
    if (rank.minPoints <= totalPoints) {
      currentRank = rank;
    } else {
      nextRank = rank;
      break;
    }
  }

  return {
    currentRank,
    nextRank,
    pointsToNextRank: nextRank ? nextRank.minPoints - totalPoints : null,
  };
};
