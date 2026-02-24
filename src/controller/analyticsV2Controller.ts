import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  getCreatorGrowthData,
  getActivationRateData,
  getPitchRateData,
  getTimeToActivationData,
  getTimeToActivationCreators as getTimeToActivationCreatorsData,
  getPitchRateCreators as getPitchRateCreatorsData,
  getMediaKitActivationData,
} from '@services/analyticsV2Service';

const prisma = new PrismaClient();

// Shared date-range parsing for analytics endpoints
const parseDateRange = async (
  req: Request,
): Promise<
  { startDate: Date; endDate: Date; granularity: 'daily' | 'monthly' } | { error: { status: number; body: object } }
> => {
  const { startDate: startParam, endDate: endParam, granularity: granParam } = req.query;
  const granularity = granParam === 'daily' ? ('daily' as const) : ('monthly' as const);

  if (startParam || endParam) {
    const startDate = new Date(startParam as string);
    const endDate = new Date(endParam as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return {
        error: { status: 400, body: { success: false, message: 'Invalid date format. Use YYYY-MM-DD.' } },
      };
    }

    if (startDate >= endDate) {
      return {
        error: { status: 400, body: { success: false, message: 'startDate must be before endDate.' } },
      };
    }

    return { startDate, endDate, granularity };
  }

  if (granularity === 'daily') {
    return {
      error: {
        status: 400,
        body: { success: false, message: 'startDate and endDate are required for daily granularity.' },
      },
    };
  }

  // Default: from earliest creator signup to end of current month
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const earliest = await prisma.user.findFirst({
    where: { role: 'creator', status: { in: ['active', 'pending'] }, creator: { isNot: null } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  const startDate = earliest
    ? new Date(earliest.createdAt.getFullYear(), earliest.createdAt.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  return { startDate, endDate, granularity };
};

export const getCreatorGrowth = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const data = await getCreatorGrowthData(parsed.startDate, parsed.endDate, parsed.granularity);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching creator growth data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch creator growth data' });
  }
};

export const getActivationRate = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const data = await getActivationRateData(parsed.startDate, parsed.endDate, parsed.granularity);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching activation rate data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch activation rate data' });
  }
};

export const getPitchRate = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const data = await getPitchRateData(parsed.startDate, parsed.endDate, parsed.granularity);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching pitch rate data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch pitch rate data' });
  }
};

export const getTimeToActivation = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const data = await getTimeToActivationData(parsed.startDate, parsed.endDate, parsed.granularity);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to activation data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch time to activation data' });
  }
};

export const getTimeToActivationCreators = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const data = await getTimeToActivationCreatorsData(startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to activation creators:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getPitchRateCreators = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const data = await getPitchRateCreatorsData(startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching pitch rate creators:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getMediaKitActivation = async (req: Request, res: Response) => {
  try {
    const { startDate: startParam, endDate: endParam } = req.query;
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startParam && endParam) {
      startDate = new Date(startParam as string);
      endDate = new Date(endParam as string);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date format.' });
      }
    }

    const data = await getMediaKitActivationData(startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching media kit activation data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch media kit activation data' });
  }
};
