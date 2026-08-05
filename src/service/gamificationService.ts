import { Prisma, PrismaClient, XpSourceType } from '@prisma/client';
import { clients, getIo } from '../config/socket';
import { GAMIFICATION_XP, RankDefinition, getPeriodId, getRankForXp } from '../constants/gamification';
import { saveNotification } from '../controller/notificationController';

const prisma = new PrismaClient();

type TxClient = Prisma.TransactionClient;

type AwardXpInput = {
  userId: string;
  sourceType: XpSourceType;
  sourceId: string;
  xp?: number;
  metadata?: Prisma.InputJsonValue;
  tx?: TxClient;
};

type AwardXpResult =
  | { awarded: false; reason: 'duplicate' | 'invalid_xp' | 'error' }
  | { awarded: true; xp: number; totalXp: number; rankUp: RankDefinition | null };

const writeXp = async (
  tx: TxClient,
  userId: string,
  sourceType: XpSourceType,
  sourceId: string,
  xp: number,
  metadata?: Prisma.InputJsonValue,
) => {
  // Ledger first — the unique constraint on [userId, sourceType, sourceId] is
  // the idempotency guard, so a replay throws P2002 before the balance moves.
  await tx.xpTransaction.create({
    data: { userId, amount: xp, sourceType, sourceId, periodId: getPeriodId(), metadata },
  });

  const balance = await tx.userXpBalance.upsert({
    where: { userId },
    create: { userId, total: xp },
    update: { total: { increment: xp } },
  });

  const newRank = getRankForXp(balance.total);
  const rankUp = newRank.id !== balance.rank ? newRank : null;

  if (rankUp) {
    await tx.userXpBalance.update({
      where: { userId },
      data: { rank: newRank.id },
    });
  }

  return { totalXp: balance.total, rankUp };
};

/**
 * Single entry point for granting XP. Every earning action in the app routes
 * through here so rank and leaderboard state stay consistent.
 *
 * Standalone (no `tx`) it never throws — a gamification failure must not roll
 * back the business action that triggered it.
 */
export const awardXp = async (input: AwardXpInput): Promise<AwardXpResult> => {
  const { userId, sourceType, sourceId, metadata, tx } = input;
  const xp = input.xp ?? GAMIFICATION_XP[sourceType];

  if (xp == null || xp <= 0) {
    console.error(`[gamification] No XP amount for ${sourceType} (sourceId=${sourceId}) — pass an explicit xp.`);
    return { awarded: false, reason: 'invalid_xp' };
  }

  // Caller owns the transaction: let errors propagate so their work rolls back
  // with ours. Notification is the caller's business once it commits.
  if (tx) {
    const result = await writeXp(tx, userId, sourceType, sourceId, xp, metadata);
    return { awarded: true, xp, totalXp: result.totalXp, rankUp: result.rankUp };
  }

  try {
    const result = await prisma.$transaction((trx) => writeXp(trx, userId, sourceType, sourceId, xp, metadata));

    void notifyXpAwarded(userId, sourceType, xp, result.totalXp, result.rankUp);

    return { awarded: true, xp, totalXp: result.totalXp, rankUp: result.rankUp };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { awarded: false, reason: 'duplicate' };
    }
    console.error('[gamification] awardXp failed:', error);
    return { awarded: false, reason: 'error' };
  }
};

type XpHistoryInput = {
  userId: string;
  limit?: number;
  cursor?: string;
  periodId?: string;
};

/**
 * Paginated ledger read, newest first. Cursor is the last seen transaction id.
 * Display copy per source type lives client-side — this returns the enum.
 *
 * `periodId` falls back to a derived value for pre-gamification hunt rows,
 * which carry NULL in the column (see the schema note on XpTransaction).
 */
export const getXpHistory = async ({ userId, limit = 20, cursor, periodId }: XpHistoryInput) => {
  const take = Math.min(Math.max(limit, 1), 50);

  const rows = await prisma.xpTransaction.findMany({
    where: { userId, ...(periodId ? { periodId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, sourceType: true, amount: true, periodId: true, metadata: true, createdAt: true },
  });

  const hasMore = rows.length > take;
  const events = hasMore ? rows.slice(0, take) : rows;

  return {
    events: events.map((event) => ({ ...event, periodId: event.periodId ?? getPeriodId(event.createdAt) })),
    nextCursor: hasMore && events.length > 0 ? events[events.length - 1].id : null,
  };
};

const notifyXpAwarded = async (
  userId: string,
  sourceType: XpSourceType,
  xp: number,
  totalXp: number,
  rankUp: RankDefinition | null,
): Promise<void> => {
  try {
    const socketId = clients.get(userId);
    if (socketId) {
      const io = getIo();
      io.to(socketId).emit('gamification:xp', { xp, sourceType, totalXp });
      if (rankUp) {
        io.to(socketId).emit('gamification:rankUp', { rank: rankUp });
      }
    }

    if (rankUp) {
      await saveNotification({
        userId,
        title: '🏆 Rank Up!',
        message: `You've reached ${rankUp.name} — ${totalXp.toLocaleString()} XP and counting.`,
        entity: 'User',
      });
    }
  } catch (error) {
    console.error('[gamification] notifyXpAwarded failed:', error);
  }
};
