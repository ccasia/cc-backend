import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { sub } from 'date-fns';

const prisma = new PrismaClient();

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
  const { startDate, endDate, packageType } = req.query;

  let dateFilter: any = {};
  if (startDate && endDate) {
    dateFilter = { gte: new Date(startDate as string), lte: new Date(endDate as string) };
  }

  let packageWhere: any = {};
  if (packageType && packageType !== 'ALL') {
    // The filter logic looks for an ACTIVE subscription matching the name
    packageWhere = {
      subscriptions: {
        some: {
          status: 'ACTIVE', // Only look at current package ??
          OR: [
            // Match Standard Package Name
            { package: { name: { equals: packageType as string, mode: 'insensitive' } } },
            // OR Match Custom Package (if type is 'Custom')
            { customPackage: { customName: { contains: packageType as string, mode: 'insensitive' } } },
          ],
        },
      },
    };
  }
  const dateCondition = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

  return { dateFilter, dateCondition, packageWhere };
};

export const getClientActivationMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { client: { company: packageWhere } } : {};

    const [totalInvited, totalActivated, activatedUsers] = await Promise.all([
      prisma.user.count({ where: { role: 'client', ...dateCondition, ...userPackageFilter } }),
      prisma.user.count({ where: { role: 'client', status: 'active', ...dateCondition, ...userPackageFilter } }),
      prisma.user.findMany({
        where: { role: 'client', status: 'active', ...dateCondition, ...userPackageFilter },
        select: { createdAt: true, activatedAt: true },
      }),
    ]);

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

    res.status(200).json({ totalInvited, totalActivated, activationRate, avgTimeHours, rateUnder24h, rateUnder7d });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activation metrics' });
  }
};

export const getClientApprovalMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition } = getFilters(req);

    const submissions = await prisma.submission.findMany({
      where: {
        // track campaigns that have clients
        campaign: { submissionVersion: 'v4' },
        status: { in: ['APPROVED', 'CLIENT_APPROVED'] },
        ...dateCondition,
      },
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
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
        name: `Sub ${sub.id.slice(-4)}`,
        x: sub.createdAt && sub.completedAt ? dayjs(sub.completedAt).diff(dayjs(sub.createdAt), 'hour') : 0,
        y: 1 + sub._count.feedback,
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
    const { dateCondition } = getFilters(req);

    const abandonedSessions = await prisma.userFlow.findMany({
      where: {
        flow: 'CAMPAIGN_CREATION',
        status: 'ABANDONED',
        ...dateCondition,
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });

    const abandonedSessionIds = abandonedSessions
      .map((session) => session.sessionId)
      .filter((id): id is string => id !== null);

    const [dropoffs, avgTimes, filledFields] = await Promise.all([
      prisma.userFlow.groupBy({
        by: ['step'],
        where: { flow: 'CAMPAIGN_CREATION', status: 'ABANDONED', ...dateCondition },
        _count: { step: true },
        orderBy: { _count: { step: 'desc' } },
        take: 5,
      }),
      prisma.userFlow.groupBy({
        by: ['step'],
        where: { flow: 'CAMPAIGN_CREATION', timeSpentSeconds: { gt: 0 }, ...dateCondition },
        _avg: { timeSpentSeconds: true },
      }),
      prisma.userFlow.findMany({
        where: {
          flow: 'CAMPAIGN_CREATION',
          meta: { not: { equals: null } },
          status: 'COMPLETED',
          sessionId: { notIn: abandonedSessionIds },
          ...dateCondition,
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
      dropoffs: dropoffs.map((d) => ({ name: d.step, value: d._count.step })),
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

interface MonthlyStats {
  name: string;
  Upgrades: number;
  Renewals: number;
  Downgrades: number;
}

export const getClientSupportMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition } = getFilters(req);

    const [bugCount, subscriptions, nps, subHistoryWithDates] = await Promise.all([
      prisma.bugs.count({ where: { user: { role: 'client' }, ...dateCondition } }),
      prisma.subscriptionHistory.groupBy({
        by: ['changeType'],
        where: dateCondition,
        _count: { id: true },
      }),
      prisma.npsFeedback.aggregate({
        where: { userType: 'CLIENT', ...dateCondition },
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.subscriptionHistory.findMany({
        where: { changeType: { in: ['RENEWAL', 'UPGRADE', 'DOWNGRADE'] }, ...dateCondition },
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

    let upgrades = 0,
      renewals = 0,
      downgrades = 0;

    subscriptions.forEach((subscription) => {
      if (subscription.changeType === 'UPGRADE') upgrades = subscription._count.id;
      if (subscription.changeType === 'RENEWAL') renewals = subscription._count.id;
      if (subscription.changeType === 'DOWNGRADE') downgrades = subscription._count.id;
    });

    let totalGapDays = 0;
    let gapCount = 0;
    const monthlyData: { [key: string]: MonthlyStats } = {};

    subHistoryWithDates.forEach((history) => {
      const oldSubscription = history.company?.subscriptions[0];
      if (history.createdAt && oldSubscription?.expiredAt) {
        const gapDays = dayjs(history.createdAt).diff(dayjs(oldSubscription.expiredAt), 'day');
        totalGapDays += Math.max(0, gapDays);
        gapCount++;
      }

      const month = dayjs(history.createdAt).format('MMM');

      if (!monthlyData[month]) {
        monthlyData[month] = { name: month, Upgrades: 0, Renewals: 0, Downgrades: 0 };
      }

      if (history.changeType === 'UPGRADE') monthlyData[month].Upgrades++;
      if (history.changeType === 'RENEWAL') monthlyData[month].Renewals++;
      if (history.changeType === 'DOWNGRADE') monthlyData[month].Downgrades++;
    });

    // Convert the object to an array for Recharts

    const totalRetention = upgrades + renewals + downgrades;
    const retentionRate = totalRetention ? Math.round(((upgrades + renewals + downgrades) / totalRetention) * 100) : 0;
    const upgradeRate = totalRetention ? Math.round((upgrades / totalRetention) * 100) : 0;
    const npsScore = nps._avg.rating ? Number(nps._avg.rating.toFixed(1)) : 0;
    const totalNpsReports = nps._count.id || 0;
    const avgDaysToNextPackage = gapCount ? Math.round(totalGapDays / gapCount) : 0;
    const monthlyRenewals = Object.values(monthlyData);

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
    const { dateCondition } = getFilters(req);

    const [statusCounts, reasonsData, timeData, fullyUtilizedCampaigns] = await Promise.all([
      prisma.pitch.groupBy({
        by: ['status'],
        where: { campaign: { submissionVersion: 'v4' }, ...dateCondition },
        _count: { id: true },
      }),
      prisma.pitch.findMany({
        where: { status: 'REJECTED', campaign: { submissionVersion: 'v4' } },
        select: { rejectionReason: true, customRejectionText: true },
      }),
      prisma.pitch.findMany({
        where: {
          status: { in: ['APPROVED', 'REJECTED'] },
          campaign: {
            submissionVersion: 'v4',
          },
          ...dateCondition,
        },
      }),
      prisma.campaign.findMany({
        where: { origin: 'CLIENT', creditsPending: 0, campaignCredits: { gt: 0 }, ...dateCondition },
        select: {
          createdAt: true,
          creatorAgreement: { select: { completedAt: true }, orderBy: { completedAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    let approved = 0,
      rejected = 0;

    statusCounts.forEach((group) => {
      if (group.status === 'APPROVED') approved += group._count.id;
      if (group.status === 'REJECTED') rejected += group._count.id;
    });

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

    let totalHours = 0,
      timeCount = 0;

    timeData.forEach((p) => {
      if (p.createdAt && p.completedAt) {
        totalHours += dayjs(p.completedAt).diff(dayjs(p.createdAt), 'hour');
        timeCount++;
      }
    });

    let selectionPhaseHours = 0;
    let selectionPhaseCount = 0;

    fullyUtilizedCampaigns.forEach((camp) => {
      const lastAgreement = camp.creatorAgreement[0];
      if (camp.createdAt && lastAgreement?.completedAt) {
        selectionPhaseHours += dayjs(lastAgreement.completedAt).diff(dayjs(camp.createdAt), 'hour');
        selectionPhaseCount++;
      }
    });

    const trendData = timeData.slice(0, 5).map((p, i) => ({
      name: `Pitch ${i + 1}`,
      hours: p.createdAt && p.completedAt ? dayjs(p.completedAt).diff(dayjs(p.createdAt), 'hour') : 0,
    }));

    const results = {
      acceptanceRate: approved + rejected > 0 ? Math.round((approved / (approved + rejected)) * 100) : 0,
      avgTurnaroundHours: timeCount ? Math.round(totalHours / timeCount) : 0,
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
