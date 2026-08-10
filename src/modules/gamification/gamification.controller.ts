import { Request, Response } from 'express';
import { getPeriodId } from '@constants/gamification';
import { calculateNextRank, getCodex, getCreatorPoints, getLeaderboard, getXpHistory } from './gamification.service';

export const getMyGamification = async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;

    const balance = await getCreatorPoints(userId);
    const totalPoints = balance?.totalPoints ?? 0;

    const progress = await calculateNextRank(totalPoints);

    return res.status(200).json({
      totalXp: totalPoints,
      currentRank: progress.currentRank,
      nextRank: progress.nextRank,
      xpToNextRank: progress.pointsToNextRank,
      periodId: getPeriodId(),
      updatedAt: balance?.updatedAt ?? null,
    });
  } catch (error) {
    console.error('[gamification] getMyGamification failed:', error);
    return res.status(500).json({ message: 'Failed to load gamification profile' });
  }
};

export const getMyXpHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const { cursor, periodId } = req.query;

    const parsedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);

    const history = await getXpHistory({
      userId,
      limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit,
      cursor: typeof cursor === 'string' ? cursor : undefined,
      periodId: typeof periodId === 'string' ? periodId : undefined,
    });

    return res.status(200).json(history);
  } catch (error) {
    console.error('[gamification] getMyXpHistory failed:', error);
    return res.status(500).json({ message: 'Failed to load XP history' });
  }
};

export const getCurrentLeaderboard = async (req: Request, res: Response) => {
  try {
    const board = await getLeaderboard(req.userId as string);
    return res.status(200).json(board);
  } catch (error) {
    console.error('[gamification] getCurrentLeaderboard failed:', error);
    return res.status(500).json({ message: 'Failed to load leaderboard' });
  }
};

export const getMyCodex = async (req: Request, res: Response) => {
  try {
    const badges = await getCodex(req.userId as string);
    return res.status(200).json({ badges });
  } catch (error) {
    console.error('[gamification] getMyCodex failed:', error);
    return res.status(500).json({ message: 'Failed to load codex' });
  }
};
