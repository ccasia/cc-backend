import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

import {
  getCreatorGrowthData,
  getCreatorGrowthCreators as getCreatorGrowthCreatorsData,
  getActivationRateData,
  getPitchRateData,
  getTimeToActivationData,
  getTimeToActivationCreators as getTimeToActivationCreatorsData,
  getTimeToIgActivationData,
  getTimeToIgActivationCreators as getTimeToIgActivationCreatorsData,
  getTimeToTiktokActivationData,
  getTimeToTiktokActivationCreators as getTimeToTiktokActivationCreatorsData,
  getPitchRateCreators as getPitchRateCreatorsData,
  getMediaKitActivationData,
  getCreatorSatisfactionData,
  getCreatorEarningsData,
  getAvgAgreementResponseData,
  getAvgAgreementResponseDetails as getAvgAgreementResponseDetailsData,
  getAvgFirstCampaignData,
  getAvgFirstCampaignDetails as getAvgFirstCampaignDetailsData,
  getAvgSubmissionResponseData,
  getAvgSubmissionResponseDetails as getAvgSubmissionResponseDetailsData,
  getClientRejectionRateData,
  getCreditsPerCSData,
  getRejectionReasonsData,
  getRequireChangesRateData,
  getTopShortlistedCreatorsData,
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

    // Include the full end day when a date-only string is sent (no time component)
    if (!(endParam as string).includes('T')) {
      endDate.setUTCHours(23, 59, 59, 999);
    }

    if (startDate > endDate) {
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

// Shared optional date-range parsing for admin-tab analytics endpoints
const parseOptionalDateRange = (
  req: Request,
): { startDate?: Date; endDate?: Date } | { error: { status: number; body: object } } => {
  const { startDate: startParam, endDate: endParam } = req.query;
  if (!startParam || !endParam) return {};

  const startDate = new Date(startParam as string);
  const endDate = new Date(endParam as string);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { error: { status: 400, body: { success: false, message: 'Invalid date format.' } } };
  }

  // Include the full end day when a date-only string is sent (no time component)
  if (!(endParam as string).includes('T')) {
    endDate.setUTCHours(23, 59, 59, 999);
  }

  return { startDate, endDate };
};

// Parse optional multi-value creditTiers query param into string array
const parseCreditTiers = (req: Request): string[] => {
  const raw = req.query.creditTiers;
  if (!raw) return [];
  const tiers = Array.isArray(raw) ? raw : [raw];
  return tiers.map((t) => String(t).trim()).filter(Boolean);
};

export const getCreatorGrowth = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getCreatorGrowthData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching creator growth data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch creator growth data' });
  }
};

export const getCreatorGrowthCreators = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const creditTierNames = parseCreditTiers(req);
    const data = await getCreatorGrowthCreatorsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching creator growth creators:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getActivationRate = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getActivationRateData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
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

    const creditTierNames = parseCreditTiers(req);
    const data = await getPitchRateData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
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

    const creditTierNames = parseCreditTiers(req);
    const data = await getTimeToActivationData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
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
    const creditTierNames = parseCreditTiers(req);
    const data = await getTimeToActivationCreatorsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to activation creators:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getTimeToIgActivation = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getTimeToIgActivationData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to IG activation data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch time to IG activation data' });
  }
};

export const getTimeToIgActivationCreators = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const creditTierNames = parseCreditTiers(req);
    const data = await getTimeToIgActivationCreatorsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to IG activation creators:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getTimeToTiktokActivation = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getTimeToTiktokActivationData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to TikTok activation data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch time to TikTok activation data' });
  }
};

export const getTimeToTiktokActivationCreators = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const creditTierNames = parseCreditTiers(req);
    const data = await getTimeToTiktokActivationCreatorsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching time to TikTok activation creators:', error);
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
    const creditTierNames = parseCreditTiers(req);
    const data = await getPitchRateCreatorsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching pitch rate creators:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getMediaKitActivation = async (req: Request, res: Response) => {
  try {
    const parsed = parseOptionalDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);
    const { startDate, endDate } = parsed;

    const creditTierNames = parseCreditTiers(req);
    const data = await getMediaKitActivationData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching media kit activation data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch media kit activation data' });
  }
};

export const getCreatorSatisfaction = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getCreatorSatisfactionData(parsed.startDate, parsed.endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching creator satisfaction data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch creator satisfaction data' });
  }
};

export const getCreatorEarnings = async (req: Request, res: Response) => {
  try {
    const parsed = parseOptionalDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);
    const { startDate, endDate } = parsed;

    const creditTierNames = parseCreditTiers(req);
    const data = await getCreatorEarningsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching creator earnings data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch creator earnings data' });
  }
};

export const getAvgAgreementResponse = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getAvgAgreementResponseData(
      parsed.startDate,
      parsed.endDate,
      parsed.granularity,
      creditTierNames,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching avg agreement response data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch avg agreement response data' });
  }
};

export const getAvgAgreementResponseDetails = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const creditTierNames = parseCreditTiers(req);
    const data = await getAvgAgreementResponseDetailsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching avg agreement response details:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getAvgFirstCampaign = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getAvgFirstCampaignData(parsed.startDate, parsed.endDate, parsed.granularity, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching avg first campaign data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch avg first campaign data' });
  }
};

export const getAvgFirstCampaignDetails = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const creditTierNames = parseCreditTiers(req);
    const data = await getAvgFirstCampaignDetailsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching avg first campaign details:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getAvgSubmissionResponse = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const creditTierNames = parseCreditTiers(req);
    const data = await getAvgSubmissionResponseData(
      parsed.startDate,
      parsed.endDate,
      parsed.granularity,
      creditTierNames,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching avg submission response data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch avg submission response data' });
  }
};

export const getAvgSubmissionResponseDetails = async (req: Request, res: Response) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }
    const creditTierNames = parseCreditTiers(req);
    const data = await getAvgSubmissionResponseDetailsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching avg submission response details:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch data' });
  }
};

export const getClientRejectionRate = async (req: Request, res: Response) => {
  try {
    const parsed = parseOptionalDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);
    const { startDate, endDate } = parsed;

    const data = await getClientRejectionRateData(startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching client rejection rate data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch client rejection rate data' });
  }
};

export const getCreditsPerCS = async (req: Request, res: Response) => {
  try {
    const parsed = parseOptionalDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);
    const { startDate, endDate } = parsed;

    const data = await getCreditsPerCSData(startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching credits per CS data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch credits per CS data' });
  }
};

export const getRejectionReasons = async (req: Request, res: Response) => {
  try {
    const parsed = parseOptionalDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);
    const { startDate, endDate } = parsed;

    const data = await getRejectionReasonsData(startDate, endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching rejection reasons data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch rejection reasons data' });
  }
};

export const getRequireChangesRate = async (req: Request, res: Response) => {
  try {
    const parsed = await parseDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);

    const data = await getRequireChangesRateData(parsed.startDate, parsed.endDate);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching require changes rate data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch require changes rate data' });
  }
};

export const getTopShortlistedCreators = async (req: Request, res: Response) => {
  try {
    const parsed = parseOptionalDateRange(req);
    if ('error' in parsed) return res.status(parsed.error.status).json(parsed.error.body);
    const { startDate, endDate } = parsed;

    const creditTierNames = parseCreditTiers(req);
    const data = await getTopShortlistedCreatorsData(startDate, endDate, creditTierNames);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching top shortlisted creators data:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch top shortlisted creators data' });
  }
};

export const trackUserFlow = async (req: Request, res: Response) => {
  const { flow, step, status, timeSpentSeconds, userId, sessionId, meta } = req.body;

  try {
    const journey = await prisma.userFlow.upsert({
      where: {
        userId_flow_step_sessionId: {
          userId,
          flow,
          step,
          sessionId,
        },
      },
      update: {
        status,
        timeSpentSeconds: {
          increment: timeSpentSeconds || 0,
        },
        meta: meta || undefined,
        updatedAt: new Date(),
      },
      create: {
        userId,
        flow,
        step,
        sessionId,
        status,
        timeSpentSeconds: timeSpentSeconds || 0,
        meta: meta || undefined,
      },
    });

    return res.status(200).json(journey);
  } catch (error) {
    console.error('Analytics Error:', error);
    return res.status(500).json({ error: 'Failed to track journey' });
  }
};

const getFilters = (req: Request) => {
  const { startDate, endDate } = req.query;
  const rawPackageTypes = req.query.packageTypes;

  let dateFilter: any = {};
  if (startDate && endDate) {
    dateFilter = { gte: new Date(startDate as string), lte: new Date(endDate as string) };
  }

  const packageTypes: string[] = rawPackageTypes
    ? (Array.isArray(rawPackageTypes) ? rawPackageTypes : [rawPackageTypes])
        .map((type) => String(type).trim())
        .filter(Boolean)
    : [];

  let packageWhere: any = {};
  if (packageTypes.length > 0) {
    // The filter logic looks for an ACTIVE subscription matching the name
    packageWhere = {
      subscriptions: {
        some: {
          OR: [
            { package: { name: { in: packageTypes, mode: 'insensitive' } } },
            ...packageTypes.map((pkg) => ({
              customPackage: { customName: { contains: pkg, mode: 'insensitive' as const } },
            })),
          ],
        },
      },
    };
  }
  const dateCondition = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

  return { dateFilter, dateCondition, packageWhere };
};

const getPreviousPeriodFilter = (dateFilter: any) => {
  if (dateFilter?.gte && dateFilter?.lte) {
    const start = dayjs(dateFilter.gte);
    const end = dayjs(dateFilter.lte);
    const durationMs = end.diff(start);

    return {
      gte: start.subtract(durationMs, 'millisecond').toDate(),
      lte: start.subtract(1, 'millisecond').toDate(),
    };
  }

  const now = dayjs();
  const currentMonthStart = now.startOf('month');
  const currentMonthEnd = now.endOf('month');
  const prevMonthStart = currentMonthStart.subtract(1, 'month');
  const prevMonthEnd = currentMonthStart.subtract(1, 'millisecond');

  return {
    gte: prevMonthStart.toDate(),
    lte: prevMonthEnd.toDate(),
  };
};

const calcTrend = (current: number, previous: number): number | null => {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

export const getBrandsMetrics = async (req: Request, res: Response) => {
  try {
    const { dateFilter, dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { client: { company: packageWhere } } : {};
    const companyPackageFilter = Object.keys(packageWhere).length ? packageWhere : {};

    const prevDateFilter = getPreviousPeriodFilter(dateFilter);
    const prevDateCondition = prevDateFilter ? { createdAt: prevDateFilter } : {};

    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const currentPeriodCondition = hasDateFilter
      ? dateCondition
      : { createdAt: { gte: dayjs().startOf('month').toDate(), lte: dayjs().endOf('month').toDate() } };

    const [
      totalCompanies,
      v4Companies,
      v2Companies,
      inactiveCompanies,
      totalInvited,
      totalActivated,
      activatedUsers,
      inactiveCompanyList,
      currentPeriodCompanies,
      currentPeriodInvited,
      currentPeriodActivated,
    ] = await Promise.all([
      prisma.company.count({ where: { ...dateCondition, ...companyPackageFilter } }),

      prisma.company.count({
        where: {
          clients: { some: {} },
          ...dateCondition,
          AND: [
            { subscriptions: { some: { status: 'ACTIVE' } } },
            Object.keys(companyPackageFilter).length ? companyPackageFilter : {},
          ],
        },
      }),

      prisma.company.count({
        where: {
          clients: { none: {} },
          ...dateCondition,
          AND: [
            { subscriptions: { some: { status: 'ACTIVE' } } },
            Object.keys(companyPackageFilter).length ? companyPackageFilter : {},
          ],
        },
      }),

      prisma.company.count({
        where: {
          ...dateCondition,
          AND: [
            { subscriptions: { none: { status: 'ACTIVE' } } },
            Object.keys(companyPackageFilter).length ? companyPackageFilter : {},
          ],
        },
      }),

      prisma.user.count({ where: { role: 'client', ...dateCondition, ...userPackageFilter } }),
      prisma.user.count({ where: { role: 'client', status: 'active', ...dateCondition, ...userPackageFilter } }),
      prisma.user.findMany({
        where: { role: 'client', status: 'active', ...dateCondition, ...userPackageFilter },
        select: { createdAt: true, activatedAt: true },
      }),
      prisma.company.findMany({
        where: {
          ...dateCondition,
          AND: [
            { subscriptions: { none: { status: 'ACTIVE' } } },
            Object.keys(companyPackageFilter).length ? companyPackageFilter : {},
          ],
        },
        select: {
          id: true,
          name: true,
          logo: true,
          createdAt: true,
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              status: true,
              expiredAt: true,
              package: { select: { name: true } },
              customPackage: { select: { customName: true } },
            },
          },
          _count: {
            select: {
              campaign: true,
              clients: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.company.count({ where: { ...currentPeriodCondition, ...companyPackageFilter } }),
      prisma.user.count({ where: { role: 'client', ...currentPeriodCondition, ...userPackageFilter } }),
      prisma.user.count({
        where: { role: 'client', status: 'active', ...currentPeriodCondition, ...userPackageFilter },
      }),
    ]);

    const [prevTotalCompanies, prevTotalInvited, prevTotalActivated] = prevDateFilter
      ? await Promise.all([
          prisma.company.count({ where: { ...prevDateCondition, ...companyPackageFilter } }),
          prisma.user.count({ where: { role: 'client', ...prevDateCondition, ...userPackageFilter } }),
          prisma.user.count({
            where: { role: 'client', status: 'active', ...prevDateCondition, ...userPackageFilter },
          }),
        ])
      : [0, 0, 0];

    let totalHours = 0;
    let actionUnder24h = 0;
    let actionUnder7d = 0;

    activatedUsers.forEach((user) => {
      if (user.activatedAt && user.createdAt) {
        const diffHours = dayjs(user.activatedAt).diff(dayjs(user.createdAt), 'hour');

        totalHours += Math.max(0, diffHours);
        if (diffHours <= 24) actionUnder24h++;
        if (diffHours <= 168) actionUnder7d++;
      }
    });

    const avgTimeHours = activatedUsers.length > 0 ? Math.round(totalHours / activatedUsers.length) : 0;

    const activationRate = totalInvited > 0 ? Math.round((totalActivated / totalInvited) * 100) : 0;

    const rateUnder24h = activatedUsers.length ? Math.round((actionUnder24h / activatedUsers.length) * 100) : 0;
    const rateUnder7d = activatedUsers.length ? Math.round((actionUnder7d / activatedUsers.length) * 100) : 0;

    const trendCompanies = hasDateFilter ? totalCompanies : currentPeriodCompanies;
    const trendInvited = hasDateFilter ? totalInvited : currentPeriodInvited;
    const trendActivated = hasDateFilter ? totalActivated : currentPeriodActivated;
    const trendActivationRate = trendInvited > 0 ? Math.round((trendActivated / trendInvited) * 100) : 0;
    const prevActivationRate = prevTotalInvited > 0 ? Math.round((prevTotalActivated / prevTotalInvited) * 100) : 0;

    const inactiveCompaniesDetail = inactiveCompanyList.map((company) => {
      const lastSub = company.subscriptions[0];
      return {
        id: company.id,
        name: company.name,
        logo: company.logo,
        createdAt: company.createdAt,
        lastPackage: lastSub?.package?.name || lastSub?.customPackage?.customName || 'No subscription',
        lastSubStatus: lastSub?.status || 'NONE',
        expiredAt: lastSub?.expiredAt || null,
        totalCampaigns: company._count.campaign,
        totalClients: company._count.clients,
      };
    });

    res.status(200).json({
      totalCompanies,
      v4Companies,
      v2Companies,
      inactiveCompanies,
      totalActivated,
      activationRate,
      avgTimeHours,
      rateUnder24h,
      rateUnder7d,
      totalCompaniesTrend: prevDateFilter ? calcTrend(trendCompanies, prevTotalCompanies) : null,
      activationRateTrend: prevDateFilter ? calcTrend(trendActivationRate, prevActivationRate) : null,
      inactiveCompaniesDetail,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activation metrics' });
  }
};

export const getClientApprovalMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { campaign: { company: packageWhere } } : {};

    const submissions = await prisma.submission.findMany({
      where: {
        // track campaigns that have clients
        campaign: { submissionVersion: 'v4' },
        status: { in: ['APPROVED', 'CLIENT_APPROVED'] },
        ...dateCondition,
        ...userPackageFilter,
      },
      include: {
        campaign: {
          select: {
            name: true,
            company: { select: { name: true } },
            brand: { select: { name: true } },
            campaignBrief: { select: { images: true } },
          },
        },
        _count: { select: { feedback: true } },
      },
    });

    let totalReviewTimeHours = 0;
    let reviewTimeCount = 0;
    let totalRounds = 0;
    let firstDraftApprovedCount = 0;
    let twoRoundsOrLessCount = 0;

    submissions.forEach((sub) => {
      const rounds = 1 + sub._count.feedback;
      totalRounds += rounds;

      if (rounds === 1) firstDraftApprovedCount++;
      if (rounds <= 2) twoRoundsOrLessCount++;

      if (sub.createdAt && sub.completedAt) {
        totalReviewTimeHours += dayjs(sub.completedAt).diff(dayjs(sub.createdAt), 'hour');
        reviewTimeCount++;
      }
    });

    const scatterPoints = submissions
      .map((sub) => ({
        id: sub.id,
        x: sub.createdAt && sub.completedAt ? dayjs(sub.completedAt).diff(dayjs(sub.createdAt), 'hour') : 0,
        y: 1 + sub._count.feedback,
        campaignName: sub.campaign.name,
        clientName: sub.campaign.company?.name || sub.campaign.brand?.name || 'Unknown',
        image: sub.campaign.campaignBrief?.images || '',
      }))
      .filter((point) => point.x > 0);

    const results = {
      firstDraftApprovalRate: submissions.length ? Math.round((firstDraftApprovedCount / submissions.length) * 100) : 0,
      avgRoundsToApproval: submissions.length ? Number((totalRounds / submissions.length).toFixed(1)) : 0,
      avgReviewTimeHours: reviewTimeCount ? Math.round(totalReviewTimeHours / reviewTimeCount) : 0,
      scatterPoints,
    };

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch review metrics' });
  }
};

export const getClientJourneyMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { user: { client: { company: packageWhere } } } : {};

    const abandonedSessions = await prisma.userFlow.findMany({
      where: {
        flow: 'CAMPAIGN_CREATION',
        status: 'ABANDONED',
        ...dateCondition,
        ...userPackageFilter,
      },
      select: { sessionId: true, step: true },
    });

    const dropoffs: Record<string, number> = {};
    const abandonedSessionIds: string[] = [];

    abandonedSessions.forEach((session) => {
      if (session.sessionId) abandonedSessionIds.push(session.sessionId);

      // Count exactly 1 drop-off per step, no duplicates
      dropoffs[session.step] = (dropoffs[session.step] || 0) + 1;
    });

    const [avgTimes, filledFields] = await Promise.all([
      prisma.userFlow.groupBy({
        by: ['step'],
        where: { flow: 'CAMPAIGN_CREATION', timeSpentSeconds: { gt: 0 }, ...dateCondition, ...userPackageFilter },
        _avg: { timeSpentSeconds: true },
      }),
      prisma.userFlow.findMany({
        where: {
          flow: 'CAMPAIGN_CREATION',
          meta: { not: { equals: null } },
          status: 'COMPLETED',
          ...(abandonedSessionIds.length > 0 ? { sessionId: { notIn: abandonedSessionIds } } : {}),
          ...dateCondition,
          ...userPackageFilter,
        },
        select: { meta: true },
      }),
    ]);

    const skippedFields: Record<string, number> = {};

    filledFields.forEach((field) => {
      const metaObj = field.meta as any;

      if (metaObj && Array.isArray(metaObj.skippedFields)) {
        metaObj.skippedFields.forEach((field: string) => {
          skippedFields[field] = (skippedFields[field] || 0) + 1;
        });
      }
    });

    const results = {
      dropoffs: Object.entries(dropoffs).map(([name, value]) => ({ name, value })),
      avgTimes: avgTimes.map((d) => ({ name: d.step, value: Math.round(d._avg.timeSpentSeconds || 0) })),
      skippedFields: Object.entries(skippedFields)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    };

    res.status(200).json(results);
  } catch (error) {
    console.error('Journey Metrics Error:', error);
    res.status(500).json({ error: 'Failed to fetch journey metrics' });
  }
};

export const getClientSupportMetrics = async (req: Request, res: Response) => {
  try {
    const { dateFilter, dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { client: { company: packageWhere } } : {};
    const companyPackageFilter = Object.keys(packageWhere).length ? packageWhere : {};

    const prevDateFilter = getPreviousPeriodFilter(dateFilter);
    const prevDateCondition = prevDateFilter ? { createdAt: prevDateFilter } : {};

    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const currentPeriodCondition = hasDateFilter
      ? dateCondition
      : { createdAt: { gte: dayjs().startOf('month').toDate(), lte: dayjs().endOf('month').toDate() } };

    const [bugCount, subscriptions, nps, subHistoryWithDates] = await Promise.all([
      prisma.bugs.count({ where: { user: { role: 'client', ...userPackageFilter }, ...dateCondition } }),
      prisma.subscriptionHistory.groupBy({
        by: ['changeType'],
        where: {
          company: companyPackageFilter,
          ...dateCondition,
        },
        _count: { id: true },
      }),
      prisma.npsFeedback.aggregate({
        where: {
          userType: 'CLIENT',
          user: userPackageFilter,
          ...dateCondition,
        },
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.subscriptionHistory.findMany({
        where: {
          changeType: { in: ['RENEWAL', 'UPGRADE', 'DOWNGRADE'] },
          company: companyPackageFilter,
          ...dateCondition,
        },
        select: {
          createdAt: true,
          changeType: true,
          company: {
            select: {
              subscriptions: { select: { expiredAt: true }, orderBy: { createdAt: 'desc' }, skip: 1, take: 1 },
            },
          },
        },
      }),
    ]);

    const [currentPeriodSubscriptions, currentPeriodNps] = !hasDateFilter
      ? await Promise.all([
          prisma.subscriptionHistory.groupBy({
            by: ['changeType'],
            where: {
              company: companyPackageFilter,
              ...currentPeriodCondition,
            },
            _count: { id: true },
          }),
          prisma.npsFeedback.aggregate({
            where: {
              userType: 'CLIENT',
              user: userPackageFilter,
              ...currentPeriodCondition,
            },
            _avg: { rating: true },
            _count: { id: true },
          }),
        ])
      : [null, null];

    const [prevSubscriptions, prevNps] = prevDateFilter
      ? await Promise.all([
          prisma.subscriptionHistory.groupBy({
            by: ['changeType'],
            where: {
              company: companyPackageFilter,
              ...prevDateCondition,
            },
            _count: { id: true },
          }),
          prisma.npsFeedback.aggregate({
            where: {
              userType: 'CLIENT',
              user: userPackageFilter,
              ...prevDateCondition,
            },
            _avg: { rating: true },
            _count: { id: true },
          }),
        ])
      : [[], { _avg: { rating: null }, _count: { id: 0 } }];

    let upgrades = 0,
      renewals = 0,
      downgrades = 0;

    subscriptions.forEach((subscription) => {
      if (subscription.changeType === 'UPGRADE') upgrades = subscription._count.id;
      if (subscription.changeType === 'RENEWAL') renewals = subscription._count.id;
      if (subscription.changeType === 'DOWNGRADE') downgrades = subscription._count.id;
    });

    let currentUpgrades = upgrades,
      currentRenewals = renewals,
      currentDowngrades = downgrades;
    if (currentPeriodSubscriptions) {
      currentUpgrades = 0;
      currentRenewals = 0;
      currentDowngrades = 0;
      currentPeriodSubscriptions.forEach((subscription: any) => {
        if (subscription.changeType === 'UPGRADE') currentUpgrades = subscription._count.id;
        if (subscription.changeType === 'RENEWAL') currentRenewals = subscription._count.id;
        if (subscription.changeType === 'DOWNGRADE') currentDowngrades = subscription._count.id;
      });
    }

    let prevUpgrades = 0,
      prevRenewals = 0,
      prevDowngrades = 0;

    (Array.isArray(prevSubscriptions) ? prevSubscriptions : []).forEach((subscription: any) => {
      if (subscription.changeType === 'UPGRADE') prevUpgrades = subscription._count.id;
      if (subscription.changeType === 'RENEWAL') prevRenewals = subscription._count.id;
      if (subscription.changeType === 'DOWNGRADE') prevDowngrades = subscription._count.id;
    });

    let totalGapDays = 0;
    let gapCount = 0;

    const monthlyRenewals: any[] = [];
    const monthMap: Record<string, any> = {};

    for (let i = 11; i >= 0; i--) {
      const monthName = dayjs().subtract(i, 'month').format('MMM YYYY');
      const newMonthData = { name: monthName, Upgrades: 0, Renewals: 0, Downgrades: 0 };

      monthlyRenewals.push(newMonthData);
      monthMap[monthName] = newMonthData;
    }

    subHistoryWithDates.forEach((history) => {
      const oldSubscription = history.company?.subscriptions[0];
      if (history.createdAt && oldSubscription?.expiredAt) {
        const gapDays = dayjs(history.createdAt).diff(dayjs(oldSubscription.expiredAt), 'day');
        totalGapDays += Math.max(0, gapDays);
        gapCount++;
      }

      const month = dayjs(history.createdAt).format('MMM YYYY');

      if (!monthMap[month]) {
        monthMap[month] = { name: month, Upgrades: 0, Renewals: 0, Downgrades: 0 };
      }

      if (history.changeType === 'UPGRADE') monthMap[month].Upgrades++;
      if (history.changeType === 'RENEWAL') monthMap[month].Renewals++;
      if (history.changeType === 'DOWNGRADE') monthMap[month].Downgrades++;
    });

    const totalRetention = upgrades + renewals + downgrades;
    const retentionRate = totalRetention ? Math.round(((upgrades + renewals + downgrades) / totalRetention) * 100) : 0;
    const upgradeRate = totalRetention ? Math.round((upgrades / totalRetention) * 100) : 0;
    const npsScore = nps._avg.rating ? Number(nps._avg.rating.toFixed(1)) : 0;
    const totalNpsReports = nps._count.id || 0;
    const avgDaysToNextPackage = gapCount ? Math.round(totalGapDays / gapCount) : 0;

    const currentTotalRetention = currentUpgrades + currentRenewals + currentDowngrades;
    const currentRetentionRate = currentTotalRetention
      ? Math.round(((currentUpgrades + currentRenewals + currentDowngrades) / currentTotalRetention) * 100)
      : 0;
    const currentNpsScore = currentPeriodNps?._avg?.rating ? Number(currentPeriodNps._avg.rating.toFixed(1)) : npsScore;
    
    const prevTotalRetention = prevUpgrades + prevRenewals + prevDowngrades;
    const prevRetentionRate = prevTotalRetention
      ? Math.round(((prevUpgrades + prevRenewals + prevDowngrades) / prevTotalRetention) * 100)
      : 0;
    const prevNpsScore = prevNps._avg?.rating ? Number(prevNps._avg.rating.toFixed(1)) : 0;

    res.json({
      totalTickets: bugCount,
      upgrades,
      renewals,
      downgrades,
      npsScore,
      totalNpsReports,
      retentionRate,
      upgradeRate,
      avgDaysToNextPackage,
      monthlyRenewals,
      retentionRateTrend: prevDateFilter ? calcTrend(hasDateFilter ? retentionRate : currentRetentionRate, prevRetentionRate) : null,
      npsScoreTrend: prevDateFilter ? calcTrend(hasDateFilter ? npsScore : currentNpsScore, prevNpsScore) : null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch support metrics' });
  }
};

export const getClientCampaignMetrics = async (req: Request, res: Response) => {
  try {
    const { dateFilter, packageWhere } = getFilters(req);
    const dateCondition = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
    const companyPackageFilter = Object.keys(packageWhere).length ? packageWhere : {};

    const [campaignsByCompany, statusCounts, timeData, totalActiveCompanies] = await Promise.all([
      // get client avgs
      prisma.campaign.groupBy({
        by: ['companyId'],
        where: { origin: 'CLIENT', ...dateCondition, company: companyPackageFilter },
        _count: { id: true },
      }),

      // campaign completion rate
      prisma.campaign.groupBy({
        by: ['status'],
        where: { origin: 'CLIENT', ...dateCondition, company: companyPackageFilter },
        _count: { id: true },
      }),

      prisma.user.findMany({
        where: { role: 'client', status: 'active', client: { company: companyPackageFilter } },
        select: {
          activatedAt: true,
          client: {
            select: {
              company: {
                select: {
                  campaign: {
                    orderBy: {
                      createdAt: 'asc',
                    },
                    take: 1,
                    select: { createdAt: true },
                  },
                },
              },
            },
          },
        },
      }),

      prisma.company.count({
        where: { clients: { some: { user: { status: 'active' } } }, ...companyPackageFilter },
      }),
    ]);

    let totalCampaigns = 0;
    let completedCampaigns = 0;

    statusCounts.forEach((group) => {
      totalCampaigns += group._count.id;
      if (['ACTIVE', 'COMPLETED', 'PAUSED'].includes(group.status)) {
        completedCampaigns += group._count.id;
      }
    });

    let timeToFirstCampaign = 0;
    let validTimeCount = 0;

    timeData.forEach((user) => {
      const firstCampaign = user.client?.company?.campaign[0];

      if (user.activatedAt && firstCampaign?.createdAt) {
        timeToFirstCampaign += Math.max(0, dayjs(firstCampaign.createdAt).diff(dayjs(user.activatedAt), 'day'));
        validTimeCount++;
      }
    });

    const results = {
      totalCampaigns,
      campaignCompletionRate: totalCampaigns ? Math.round((completedCampaigns / totalCampaigns) * 100) : 0,
      avgCampaignsPerBrand: campaignsByCompany.length
        ? Number((totalCampaigns / campaignsByCompany.length).toFixed(1))
        : 0,
      avgTimeToFirstCampaign: validTimeCount ? Math.round(timeToFirstCampaign / validTimeCount) : 0,
      campaignCreationRate:
        totalActiveCompanies > 0 ? Math.round((campaignsByCompany.length / totalActiveCompanies) * 100) : 0,
    };
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch campaign metrics' });
  }
};

export const getClientShortlistMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition, packageWhere } = getFilters(req);

    const pitchPackageFilter = Object.keys(packageWhere).length ? { campaign: { company: packageWhere } } : {};
    const campaignPackageFilter = Object.keys(packageWhere).length ? { company: packageWhere } : {};

    const [reasonsData, timeData, fullyUtilizedCampaigns] = await Promise.all([
      prisma.pitch.findMany({
        where: {
          status: 'REJECTED',
          campaign: { submissionVersion: 'v4' },
          ...dateCondition,
          ...pitchPackageFilter,
        },
        select: { rejectionReason: true, customRejectionText: true },
      }),
      prisma.pitch.findMany({
        where: {
          status: { in: ['APPROVED', 'REJECTED'] },
          campaign: {
            submissionVersion: 'v4',
          },
          ...dateCondition,
          ...pitchPackageFilter,
        },
        select: {
          createdAt: true,
          completedAt: true,
          campaign: {
            select: {
              name: true,
              company: { select: { name: true } },
              campaignBrief: { select: { images: true } },
            },
          },
        },
      }),
      prisma.campaign.findMany({
        where: {
          origin: 'CLIENT',
          creditsPending: 0,
          campaignCredits: { gt: 0 },
          ...dateCondition,
          ...campaignPackageFilter,
        },
        select: {
          createdAt: true,
          company: { select: { name: true } },
          creatorAgreement: { select: { completedAt: true }, orderBy: { completedAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    // rejection reasons
    const reasons: Record<string, number> = {};

    reasonsData.forEach((p) => {
      let reason = 'No Reason Provided';

      if (p.rejectionReason && p.rejectionReason !== 'Other') {
        reason = p.rejectionReason;
      } else if (p.customRejectionText) {
        reason = 'Other';
      }
      reasons[reason] = (reasons[reason] || 0) + 1;
    });

    // selection phase tracker
    let selectionPhaseHours = 0;
    let selectionPhaseCount = 0;

    const companySelectionStats: Record<string, { totalHours: number; count: number }> = {};
    const monthlySelection: Record<string, { totalHours: number; count: number }> = {};

    for (let i = 5; i >= 0; i--) {
      monthlySelection[dayjs().subtract(i, 'month').format('MMM YYYY')] = { totalHours: 0, count: 0 };
    }

    fullyUtilizedCampaigns.forEach((campaign) => {
      const lastAgreement = campaign.creatorAgreement[0];
      if (campaign.createdAt && lastAgreement?.completedAt) {
        const diffHours = dayjs(lastAgreement.completedAt).diff(dayjs(campaign.createdAt), 'hour');
        selectionPhaseHours += diffHours;
        selectionPhaseCount++;

        const company = campaign.company?.name || 'Unknown Brand';
        if (!companySelectionStats[company]) companySelectionStats[company] = { totalHours: 0, count: 0 };
        companySelectionStats[company].totalHours += diffHours;
        companySelectionStats[company].count++;

        const month = dayjs(lastAgreement.completedAt).format('MMM YYYY');
        if (monthlySelection[month]) {
          monthlySelection[month].totalHours += diffHours;
          monthlySelection[month].count++;
        }
      }
    });

    // turnaround trend
    const turnaroundMonths: Record<string, any> = {};

    for (let i = 11; i >= 0; i--) {
      turnaroundMonths[dayjs().subtract(i, 'month').format('MMM YY')] = {
        totalHours: 0,
        count: 0,
        campaigns: {},
      };
    }

    let overallTotalHours = 0,
      turnaroundCount = 0;

    timeData.forEach((p) => {
      if (p.createdAt && p.completedAt) {
        const hours = dayjs(p.completedAt).diff(dayjs(p.createdAt), 'hour');
        const month = dayjs(p.completedAt).format('MMM YY');
        const campaignName = p.campaign?.name || 'Unknown Campaign';
        const clientName = p.campaign?.company?.name || 'Unknown Client';
        const image = p.campaign?.campaignBrief?.images || '';

        overallTotalHours += hours;
        turnaroundCount++;

        if (turnaroundMonths[month]) {
          turnaroundMonths[month].totalHours += hours;
          turnaroundMonths[month].count++;

          if (!turnaroundMonths[month].campaigns[campaignName]) {
            turnaroundMonths[month].campaigns[campaignName] = {
              name: campaignName,
              clientName,
              image,
              totalHours: 0,
              count: 0,
              min: hours,
              max: hours,
            };
          }

          const campaignStats = turnaroundMonths[month].campaigns[campaignName];
          campaignStats.totalHours += hours;
          campaignStats.count++;
          if (hours < campaignStats.min) campaignStats.min = hours;
          if (hours > campaignStats.max) campaignStats.max = hours;
        }
      }
    });

    type CampaignStats = { name: string; clientName: string; image: any; avg: number; min: number; max: number };

    const trendData = Object.entries(turnaroundMonths).map(([month, stats]) => {
      const platformAvg = stats.count > 0 ? Math.round(stats.totalHours / stats.count) : 0;

      const campaignsArray: CampaignStats[] = Object.entries(stats.campaigns).map(([name, cStats]: [string, any]) => ({
        name,
        clientName: cStats.clientName,
        image: cStats.image,
        avg: Math.round(cStats.totalHours / cStats.count),
        min: cStats.min,
        max: cStats.max,
      }));

      campaignsArray.sort((a, b) => a.avg - b.avg);

      const fastestCampaign = campaignsArray.length > 0 ? campaignsArray[0] : null;
      const slowestCampaign = campaignsArray.length > 0 ? campaignsArray[campaignsArray.length - 1] : null;

      return {
        name: month,
        average: platformAvg > 0 ? platformAvg : null,
        slowestAvg: slowestCampaign ? slowestCampaign.avg : null,
        slowestCampaign,
        fastestAvg: fastestCampaign ? fastestCampaign.avg : null,
        fastestCampaign,
      };
    });

    const results = {
      avgTurnaroundHours: turnaroundCount ? Math.round(overallTotalHours / turnaroundCount) : 0,
      rejectionReasons: Object.entries(reasons)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      avgSelectionPhaseDays: selectionPhaseCount ? Math.round(selectionPhaseHours / selectionPhaseCount / 24) : 0,
      trendData,
    };

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shortlist metrics' });
  }
};
