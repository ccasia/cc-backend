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
          OR: [
            { package: { name: { equals: packageType as string, mode: 'insensitive' } } },
            { customPackage: { customName: { contains: packageType as string, mode: 'insensitive' } } },
          ],
        },
      },
    };
  }
  const dateCondition = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

  return { dateFilter, dateCondition, packageWhere };
};

export const getBrandsMetrics = async (req: Request, res: Response) => {
  try {
    const { dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { client: { company: packageWhere } } : {};
    const companyPackageFilter = Object.keys(packageWhere).length ? packageWhere : {};

    const [totalCompanies, v4Companies, v2Companies, inactiveCompanies, totalInvited, totalActivated, activatedUsers] =
      await Promise.all([
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
    const { dateCondition, packageWhere } = getFilters(req);

    const userPackageFilter = Object.keys(packageWhere).length ? { client: { company: packageWhere } } : {};
    const companyPackageFilter = Object.keys(packageWhere).length ? packageWhere : {};

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

    const monthlyRenewals: any[] = [];
    const monthMap: Record<string, any> = {};

    // Loop backwards from 5 to 0 to get chronological order (e.g., Oct, Nov, Dec, Jan, Feb, Mar)
    for (let i = 11; i >= 0; i--) {
      const monthName = dayjs().subtract(i, 'month').format('MMM YYYY');
      const newMonthData = { name: monthName, Upgrades: 0, Renewals: 0, Downgrades: 0 };

      monthlyRenewals.push(newMonthData);
      monthMap[monthName] = newMonthData; // Keep a reference map for O(1) lookups
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

    // Convert the object to an array for Recharts

    const totalRetention = upgrades + renewals + downgrades;
    const retentionRate = totalRetention ? Math.round(((upgrades + renewals + downgrades) / totalRetention) * 100) : 0;
    const upgradeRate = totalRetention ? Math.round((upgrades / totalRetention) * 100) : 0;
    const npsScore = nps._avg.rating ? Number(nps._avg.rating.toFixed(1)) : 0;
    const totalNpsReports = nps._count.id || 0;
    const avgDaysToNextPackage = gapCount ? Math.round(totalGapDays / gapCount) : 0;

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
