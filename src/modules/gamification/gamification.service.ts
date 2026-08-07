import { Prisma, Rank, RewardType } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { clients, getIo } from '@configs/socket';
import { saveNotification } from '@controllers/notificationController';
import { getPeriodId } from '@constants/gamification';

type ExtendedClient = typeof prisma;
type TxClient = Omit<ExtendedClient, '$connect' | '$disconnect' | '$transaction' | '$on' | '$use' | '$extends'>;

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
  | 'weekly_tasks'
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

export const getPointAction = async (
  code: PointActionCode | string,
  tx: TxClient = prisma,
): Promise<PointActionRecord | null> => {
  const action = await tx.xpAction.findUnique({ where: { code } });
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

export const getCreatorPoints = async (
  creatorId: string,
  tx: TxClient = prisma,
): Promise<CreatorPointsRecord | null> => {
  const balance = await tx.userXpBalance.findUnique({
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

export const calculateNextRank = async (totalPoints: number, tx: TxClient = prisma): Promise<RankProgress> => {
  const ranks = await tx.rank.findMany({ orderBy: { minPoints: 'asc' } });

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

// ─────────────────────────── Awards ───────────────────────────

type AwardXpInput = {
  userId: string;
  actionCode: PointActionCode | string;
  sourceId?: string;
  xp?: number;
  metadata?: Prisma.InputJsonValue;
  tx?: TxClient;
};

type AwardXpResult =
  | { awarded: false; reason: 'duplicate' | 'unknown_action' | 'invalid_xp' | 'error' }
  | { awarded: true; xp: number; totalPoints: number; rankUp: Rank | null };

const writeXp = async (
  tx: TxClient,
  userId: string,
  action: PointActionRecord,
  sourceId: string,
  xp: number,
  metadata?: Prisma.InputJsonValue,
) => {
  await tx.xpTransaction.create({
    data: {
      userId,
      amount: xp,
      actionId: action.id,
      sourceId,
      periodId: getPeriodId(),
      metadata,
    },
  });

  const existing = await getCreatorPoints(userId, tx);
  const totalPoints = (existing?.totalPoints ?? 0) + xp;

  if (existing) {
    await tx.userXpBalance.update({
      where: { userId },
      data: { total: { increment: xp } },
    });
  } else {
    const lowest = await tx.rank.findFirst({
      orderBy: { minPoints: 'asc' },
    });
    if (!lowest) throw new Error('[gamification] No ranks seeded — run yarn seed-gamification.');

    await tx.userXpBalance.create({
      data: { userId, total: xp, currentRankId: lowest.id },
    });
  }

  const rankUp = await recalculateRank(userId, totalPoints, existing?.currentRankId ?? null, tx);

  return { totalPoints, rankUp };
};

export const awardXp = async (input: AwardXpInput): Promise<AwardXpResult> => {
  const { userId, actionCode, metadata, tx } = input;

  const action = await getPointAction(actionCode, tx);
  if (!action) {
    console.error(`[gamification] Unknown action code "${actionCode}".`);
    return { awarded: false, reason: 'unknown_action' };
  }

  const xp = input.xp ?? action.points;
  if (xp == null || xp <= 0) {
    console.error(`[gamification] No XP amount for "${actionCode}" — pass an explicit xp.`);
    return { awarded: false, reason: 'invalid_xp' };
  }

  const sourceId = action.isOneTime ? action.code : input.sourceId;
  if (!sourceId) {
    console.error(`[gamification] "${actionCode}" is repeatable and needs a sourceId.`);
    return { awarded: false, reason: 'invalid_xp' };
  }

  if (tx) {
    const result = await writeXp(tx, userId, action, sourceId, xp, metadata);
    return { awarded: true, xp, totalPoints: result.totalPoints, rankUp: result.rankUp };
  }

  try {
    const result = await prisma.$transaction(async (trx) => {
      return writeXp(trx, userId, action, sourceId, xp, metadata);
    });

    void notifyXpAwarded(userId, action, xp, result.totalPoints, result.rankUp);

    return { awarded: true, xp, totalPoints: result.totalPoints, rankUp: result.rankUp };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { awarded: false, reason: 'duplicate' };
    }
    console.error('[gamification] awardXp failed:', error);
    return { awarded: false, reason: 'error' };
  }
};

export const recalculateRank = async (
  userId: string,
  totalPoints: number,
  currentRankId: string | null,
  tx: TxClient = prisma,
): Promise<Rank | null> => {
  const { currentRank } = await calculateNextRank(totalPoints, tx);
  if (!currentRank || currentRank.id === currentRankId) return null;

  if (currentRankId) {
    const current = await tx.rank.findUnique({
      where: { id: currentRankId },
      select: { minPoints: true },
    });

    if (current && currentRank.minPoints < current.minPoints) return null;
  }

  await tx.userXpBalance.update({
    where: { userId },
    data: { currentRankId: currentRank.id },
  });

  return currentRank;
};

type XpHistoryInput = {
  userId: string;
  limit?: number;
  cursor?: string;
  periodId?: string;
};

export const getXpHistory = async ({ userId, limit = 20, cursor, periodId }: XpHistoryInput) => {
  const take = Math.min(Math.max(limit, 1), 50);

  const rows = await prisma.xpTransaction.findMany({
    where: { userId, ...(periodId ? { periodId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      amount: true,
      periodId: true,
      metadata: true,
      createdAt: true,
      action: { select: { code: true, name: true } },
    },
  });

  const hasMore = rows.length > take;
  const events = hasMore ? rows.slice(0, take) : rows;

  return {
    events: events.map((event) => ({
      id: event.id,
      amount: event.amount,
      actionCode: event.action?.code ?? null,
      actionName: event.action?.name ?? null,
      metadata: event.metadata,
      createdAt: event.createdAt,
      periodId: event.periodId ?? getPeriodId(event.createdAt),
    })),
    nextCursor: hasMore && events.length > 0 ? events[events.length - 1].id : null,
  };
};

const notifyXpAwarded = async (
  userId: string,
  action: PointActionRecord,
  xp: number,
  totalPoints: number,
  rankUp: Rank | null,
): Promise<void> => {
  try {
    const socketId = clients.get(userId);
    if (socketId) {
      const io = getIo();
      io.to(socketId).emit('gamification:xp', { xp, actionCode: action.code, totalPoints });
      if (rankUp) {
        io.to(socketId).emit('gamification:rankUp', { rank: rankUp });
      }
    }

    if (rankUp) {
      await saveNotification({
        userId,
        title: '🏆 Rank Up!',
        message: `You've reached ${rankUp.name} — ${totalPoints.toLocaleString()} XP and counting.`,
        entity: 'User',
      });
    }
  } catch (error) {
    console.error('[gamification] notifyXpAwarded failed:', error);
  }
};
