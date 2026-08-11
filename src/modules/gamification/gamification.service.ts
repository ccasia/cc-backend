import { Prisma, Rank, RewardType } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { clients, getIo } from '@configs/socket';
import { saveNotification } from '@controllers/notificationController';
import { getPeriodId } from '@constants/gamification';
import { previousDay } from 'date-fns';
import { RowType } from 'xero-node';

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
  periodId?: string;
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
  periodId: string = getPeriodId(),
) => {
  await tx.xpTransaction.create({
    data: {
      userId,
      amount: xp,
      actionId: action.id,
      sourceId,
      periodId,
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
  const { userId, actionCode, metadata, tx, periodId } = input;

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
    const result = await writeXp(tx, userId, action, sourceId, xp, metadata, periodId);
    return { awarded: true, xp, totalPoints: result.totalPoints, rankUp: result.rankUp };
  }

  try {
    const result = await prisma.$transaction(async (trx) => {
      return writeXp(trx, userId, action, sourceId, xp, metadata, periodId);
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

// ─────────────────────────── Leaderboard ───────────────────────────
export type LeaderboardEntry = {
  id: string;
  rank: number;
  name: string;
  xp: number;
  avatarUrl: string | null;
  rankDelta: number;
  isCurrentUser: boolean;
};

const previousPeriodId = (periodId: string): string => {
  const [year, month] = periodId.split('-').map(Number);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return prev.toISOString().slice(0, 7);
};

export const getLeaderboard = async (
  viewerId: string,
  limit = 20,
  tx: TxClient = prisma,
): Promise<{ periodId: string; entries: LeaderboardEntry[]; viewerEntry: LeaderboardEntry | null }> => {
  const take = Math.min(Math.max(limit, 1), 100);
  const periodId = getPeriodId();

  const previous = await tx.leaderboardSnapshot.findMany({
    where: { periodId: previousPeriodId(periodId) },
    select: { userId: true, rank: true },
  });
  const previousRanks = new Map(previous.map((row) => [row.userId, row.rank]));

  const totals = await tx.xpTransaction.groupBy({
    by: ['userId'],
    where: { periodId },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
    take,
  });

  const users = await tx.user.findMany({
    where: { id: { in: totals.map((row) => row.userId) } },
    select: { id: true, name: true, photoURL: true },
  });
  const userById = new Map(users.map((user) => [user.id, user]));

  const entries = totals.map((row, index) => {
    const rank = index + 1;
    const previousRank = previousRanks.get(row.userId);

    return {
      id: row.userId,
      rank,
      name: userById.get(row.userId)?.name ?? 'Unknown Creator',
      xp: row._sum.amount ?? 0,
      avatarUrl: userById.get(row.userId)?.photoURL ?? null,
      rankDelta: previousRank ? previousRank - rank : 0,
      isCurrentUser: row.userId === viewerId,
    };
  });

  return {
    periodId,
    entries,
    viewerEntry: entries.find((entry) => entry.isCurrentUser) ?? null,
  };
};

// ─────────────────────────── Codex ───────────────────────────
const SECRET_PLACEHOLDER = {
  name: '???',
  description: 'Keep creating to uncover this one.',
  icon: 'help-circle-outline',
};

export const getCodex = async (userId: string, tx: TxClient = prisma) => {
  const [achievements, earned, totalCreators, myEvents] = await Promise.all([
    tx.achievement.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    }),
    tx.creatorAchievement.findMany({ where: { userId } }),
    tx.user.count({ where: { role: 'creator' } }),
    // Progress is derived, not stored — one grouped query covers all badges.
    tx.creatorAchievementEvent.groupBy({
      by: ['achievementId'],
      where: { userId },
      _sum: { increment: true },
    }),
  ]);

  const progressByAchievement = new Map(earned.map((row) => [row.achievementId, row]));
  const progressCount = new Map(myEvents.map((row) => [row.achievementId, row._sum.increment ?? 0]));

  const unlockedCounts = await tx.creatorAchievement.groupBy({
    by: ['achievementId'],
    where: { unlockedAt: { not: null } },
    _count: { userId: true },
  });
  const unlockedBy = new Map(unlockedCounts.map((row) => [row.achievementId, row._count.userId]));

  return achievements.map((achievement) => {
    const mine = progressByAchievement.get(achievement.id);
    const unlocked = Boolean(mine?.unlockedAt);
    const hidden = achievement.rarity === 'secret' && !unlocked;

    return {
      id: achievement.id,
      name: hidden ? SECRET_PLACEHOLDER.name : achievement.name,
      description: hidden ? SECRET_PLACEHOLDER.description : achievement.description,
      icon: hidden ? SECRET_PLACEHOLDER.icon : achievement.icon,
      category: achievement.category,
      rarity: achievement.rarity,
      xp: achievement.xp,
      unlocked,
      // Unlocked badges show a full bar even if the qualifying events predate
      // the event ledger.
      progressCurrent: unlocked ? achievement.target : (progressCount.get(achievement.id) ?? 0),
      progressTarget: achievement.target,
      earnedPercent: totalCreators > 0 ? Math.round(((unlockedBy.get(achievement.id) ?? 0) / totalCreators) * 100) : 0,
    };
  });
};

const applyAchievementProgress = async (
  userId: string,
  achievementId: string,
  increment = 1,
  sourceId: string,
  tx: TxClient = prisma,
): Promise<{ unlocked: boolean }> => {
  const achievement = await tx.achievement.findUnique({
    where: { id: achievementId },
  });
  if (!achievement || !achievement.active) return { unlocked: false };

  // The row must exist before an event can reference it (composite FK).
  const existing = await tx.creatorAchievement.upsert({
    where: { userId_achievementId: { userId, achievementId } },
    create: { userId, achievementId },
    update: {},
  });

  // Already unlocked — nothing further to record.
  if (existing.unlockedAt) return { unlocked: false };

  // The unique key is what makes this idempotent: a retried request, or two
  // routes reaching the same approval, collide here instead of double-counting.
  try {
    await tx.creatorAchievementEvent.create({
      data: { userId, achievementId, sourceId, increment },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { unlocked: false };
    }
    throw error;
  }

  // Derived, never cached — the events are the only source of truth.
  const totals = await tx.creatorAchievementEvent.aggregate({
    where: { userId, achievementId },
    _sum: { increment: true },
  });

  if ((totals._sum.increment ?? 0) < achievement.target) {
    return { unlocked: false };
  }

  await tx.creatorAchievement.update({
    where: { userId_achievementId: { userId, achievementId } },
    data: { unlockedAt: new Date() },
  });

  await awardXp({
    userId,
    actionCode: 'achievement',
    sourceId: achievementId,
    xp: achievement.xp,
    metadata: { achievementId, name: achievement.name },
    tx,
  });

  return { unlocked: true };
};

type ProgressAchievementInput = {
  userId: string;
  code: string;
  /**
   * Natural key of the thing that caused this progress — a pitchId, a
   * submissionId. Repeat calls with the same sourceId are ignored, so a retried
   * request or two routes reaching the same approval can't double-count.
   *
   * Omit only for one-shot badges with no meaningful source (first-light): the
   * badge code is used instead, capping it at a single event.
   */
  sourceId?: string;
  increment?: number;
  tx?: TxClient;
};

export const progressAchievement = async ({
  userId,
  code,
  sourceId,
  increment = 1,
  tx = prisma,
}: ProgressAchievementInput): Promise<{ unlocked: boolean }> => {
  try {
    const achievement = await tx.achievement.findUnique({
      where: { code },
      select: { id: true },
    });

    if (!achievement) {
      console.error(`[gamification] Unknown achievement code "${code}".`);
      return { unlocked: false };
    }

    return await applyAchievementProgress(userId, achievement.id, increment, sourceId ?? code, tx);
  } catch (error) {
    console.error(`[gamification] progressAchievement("${code}") failed:`, error);
    return { unlocked: false };
  }
};

// ─────────────────────────── Snapshot ───────────────────────────
type SnapshotResult = {
  periodId: string;
  ranked: number;
  awarded: number;
  skipped: boolean;
};

export const snapshotLeaderboard = async (periodId: string): Promise<SnapshotResult> => {
  if (periodId >= getPeriodId()) {
    console.warn(`[gamification] Refusing to snapshot in-progress period ${periodId}.`);
    return { periodId, ranked: 0, awarded: 0, skipped: true };
  }

  const totals = await prisma.xpTransaction.groupBy({
    by: ['userId'],
    where: { periodId },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
  });

  if (totals.length === 0) {
    return { periodId, ranked: 0, awarded: 0, skipped: false };
  }

  const standings = totals.map((row, index) => ({
    userId: row.userId,
    xp: row._sum.amount ?? 0,
    rank: index + 1,
  }));

  await prisma.$transaction(
    standings.map((entry) =>
      prisma.leaderboardSnapshot.upsert({
        where: { periodId_userId: { periodId, userId: entry.userId } },
        create: { periodId, userId: entry.userId, rank: entry.rank, xp: entry.xp },
        update: { rank: entry.rank, xp: entry.xp },
      }),
    ),
  );

  let awarded = 0;

  for (const entry of standings) {
    if (entry.rank > 10) break;

    const actionCode = entry.rank <= 3 ? 'leaderboard_top_3' : 'leaderboard_top_10';

    const result = await awardXp({
      userId: entry.userId,
      actionCode,
      sourceId: periodId,
      periodId,
      metadata: { periodId, rank: entry.rank, xp: entry.xp },
    });

    if (result.awarded) awarded += 1;
  }

  return { periodId, ranked: standings.length, awarded, skipped: false };
};
