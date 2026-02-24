import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DemographicItem {
  label: string;
  value: number;
  color: string;
}

interface CreatorGrowthMonth {
  month: string;
  total: number;
  newSignups: number;
  growthRate: number;
}

interface CreatorGrowthDay {
  date: string; // "Feb 17" — display label
  isoDate: string; // "2026-02-17" — reliable parsing
  total: number;
  newSignups: number;
  growthRate: number;
}

interface PeriodComparison {
  currentPeriodSignups: number;
  previousPeriodSignups: number;
  percentChange: number;
}

interface CreatorGrowthResponse {
  granularity: 'daily' | 'monthly';
  creatorGrowth: CreatorGrowthMonth[] | CreatorGrowthDay[];
  demographics: {
    gender: DemographicItem[];
    ageGroups: DemographicItem[];
  };
  periodComparison?: PeriodComparison;
}

interface MonthlySignupRow {
  year: number;
  month: number;
  count: number;
}

interface DailySignupRow {
  date: string; // 'YYYY-MM-DD'
  count: number;
}

// Format month number + year into short label (e.g. "Feb 24")
const formatMonthLabel = (year: number, month: number): string => {
  const date = new Date(year, month - 1);
  const monthStr = date.toLocaleString('en-US', { month: 'short' });
  const yearStr = String(year).slice(-2);
  return `${monthStr} ${yearStr}`;
};

// Format a date into a short display label (e.g. "Feb 17")
const formatDayLabel = (d: Date): string => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });

// Format a date into ISO string "YYYY-MM-DD"
const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Calculate age from birthDate
const calculateAge = (birthDate: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

// Fill gaps in monthly data and compute cumulative totals + growth rates
const fillMonthGaps = (
  rows: MonthlySignupRow[],
  startDate: Date,
  endDate: Date,
  baseline: number,
): CreatorGrowthMonth[] => {
  // Build lookup map from query results
  const signupMap = new Map<string, number>();
  for (const row of rows) {
    signupMap.set(`${row.year}-${row.month}`, row.count);
  }

  const result: CreatorGrowthMonth[] = [];
  let cumulativeTotal = baseline;
  let prevNewSignups = 0;

  // Iterate each calendar month in the range
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const key = `${year}-${month}`;

    const newSignups = signupMap.get(key) || 0;
    cumulativeTotal += newSignups;

    // Month-over-month signup comparison
    const growthRate =
      prevNewSignups > 0 ? Math.round(((newSignups - prevNewSignups) / prevNewSignups) * 100 * 10) / 10 : 0;

    result.push({
      month: formatMonthLabel(year, month),
      total: cumulativeTotal,
      newSignups,
      growthRate,
    });

    prevNewSignups = newSignups;

    // Advance to next month
    current.setMonth(current.getMonth() + 1);
  }

  return result;
};

// Fill gaps in daily data and compute cumulative totals + growth rates
const fillDayGaps = (rows: DailySignupRow[], startDate: Date, endDate: Date, baseline: number): CreatorGrowthDay[] => {
  // Build lookup map keyed by ISO date string
  const signupMap = new Map<string, number>();
  for (const row of rows) {
    signupMap.set(row.date, row.count);
  }

  const result: CreatorGrowthDay[] = [];
  let cumulativeTotal = baseline;
  let prevNewSignups = 0;

  // Iterate day-by-day from startDate to endDate
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  while (current <= end) {
    const key = toIsoDate(current);
    const newSignups = signupMap.get(key) || 0;
    cumulativeTotal += newSignups;

    const growthRate =
      prevNewSignups > 0 ? Math.round(((newSignups - prevNewSignups) / prevNewSignups) * 100 * 10) / 10 : 0;

    result.push({
      date: formatDayLabel(current),
      isoDate: key,
      total: cumulativeTotal,
      newSignups,
      growthRate,
    });

    prevNewSignups = newSignups;
    current.setDate(current.getDate() + 1);
  }

  return result;
};

export const getCreatorGrowthData = async (
  startDate: Date,
  endDate: Date,
  granularity: 'daily' | 'monthly' = 'monthly',
): Promise<CreatorGrowthResponse> => {
  // Demographics queries are the same regardless of granularity
  const demographicsPromise = Promise.all([
    prisma.creator.findMany({
      where: {
        user: { role: 'creator', status: { in: ['active', 'pending'] } },
      },
      select: { pronounce: true },
    }),
    prisma.creator.findMany({
      where: {
        user: { role: 'creator', status: { in: ['active', 'pending'] } },
        birthDate: { not: null },
      },
      select: { birthDate: true },
    }),
  ]);

  // Baseline count (creators before the date range)
  const baselinePromise = prisma.user.count({
    where: {
      role: 'creator',
      status: { in: ['active', 'pending'] },
      createdAt: { lt: startDate },
    },
  });

  if (granularity === 'daily') {
    // --- Daily granularity ---
    const [dailySignups, baseline, [genderData, ageData]] = await Promise.all([
      prisma.$queryRaw<DailySignupRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS count
        FROM "User" u
        INNER JOIN "Creator" c ON c."userId" = u.id
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND u."createdAt" >= (${startDate} AT TIME ZONE 'UTC')
          AND u."createdAt" <= (${endDate} AT TIME ZONE 'UTC')
        GROUP BY DATE_TRUNC('day', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
        ORDER BY 1
      `,
      baselinePromise,
      demographicsPromise,
    ]);

    const creatorGrowth = fillDayGaps(dailySignups, startDate, endDate, baseline);

    // Period comparison: compare current period signups vs previous period of same length
    const periodMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);

    const [currentPeriodSignups, previousPeriodSignups] = await Promise.all([
      prisma.user.count({
        where: {
          role: 'creator',
          status: { in: ['active', 'pending'] },
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.user.count({
        where: {
          role: 'creator',
          status: { in: ['active', 'pending'] },
          createdAt: { gte: prevStart, lte: prevEnd },
        },
      }),
    ]);

    const percentChange =
      previousPeriodSignups > 0
        ? Math.round(((currentPeriodSignups - previousPeriodSignups) / previousPeriodSignups) * 100 * 10) / 10
        : 0;

    const demographics = processDemographics(genderData, ageData);

    return {
      granularity: 'daily',
      creatorGrowth,
      demographics,
      periodComparison: { currentPeriodSignups, previousPeriodSignups, percentChange },
    };
  }

  // --- Monthly granularity (default) ---
  const [monthlySignups, baseline, [genderData, ageData]] = await Promise.all([
    prisma.$queryRaw<MonthlySignupRow[]>`
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
        EXTRACT(MONTH FROM DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
        COUNT(*)::int AS count
      FROM "User" u
      INNER JOIN "Creator" c ON c."userId" = u.id
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND u."createdAt" >= (${startDate} AT TIME ZONE 'UTC')
        AND u."createdAt" <= (${endDate} AT TIME ZONE 'UTC')
      GROUP BY DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1, 2
    `,
    baselinePromise,
    demographicsPromise,
  ]);

  const creatorGrowth = fillMonthGaps(monthlySignups, startDate, endDate, baseline);
  const demographics = processDemographics(genderData, ageData);

  return {
    granularity: 'monthly',
    creatorGrowth,
    demographics,
  };
};

// Activation Rate

interface ActivationRateMonth {
  month: string;
  rate: number;
  activated: number;
  total: number;
}

interface ActivationRateDay {
  date: string;
  isoDate: string;
  rate: number;
  activated: number;
  total: number;
}

interface ActivationRatePeriodComparison {
  currentRate: number;
  previousRate: number;
  percentChange: number;
}

interface ActivationRateResponse {
  granularity: 'daily' | 'monthly';
  activationRate: ActivationRateMonth[] | ActivationRateDay[];
  periodComparison?: ActivationRatePeriodComparison;
}

const fillActivationMonthGaps = (
  activationRows: MonthlySignupRow[],
  signupRows: MonthlySignupRow[],
  startDate: Date,
  endDate: Date,
  activatedBaseline: number,
  totalBaseline: number,
): ActivationRateMonth[] => {
  const activationMap = new Map<string, number>();
  for (const row of activationRows) activationMap.set(`${row.year}-${row.month}`, row.count);

  const signupMap = new Map<string, number>();
  for (const row of signupRows) signupMap.set(`${row.year}-${row.month}`, row.count);

  const result: ActivationRateMonth[] = [];
  let cumulativeActivated = activatedBaseline;
  let cumulativeTotal = totalBaseline;

  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const key = `${year}-${month}`;

    cumulativeActivated += activationMap.get(key) || 0;
    cumulativeTotal += signupMap.get(key) || 0;

    const rate = cumulativeTotal > 0 ? Math.round((cumulativeActivated / cumulativeTotal) * 1000) / 10 : 0;

    result.push({
      month: formatMonthLabel(year, month),
      rate,
      activated: cumulativeActivated,
      total: cumulativeTotal,
    });

    current.setMonth(current.getMonth() + 1);
  }

  return result;
};

const fillActivationDayGaps = (
  activationRows: DailySignupRow[],
  signupRows: DailySignupRow[],
  startDate: Date,
  endDate: Date,
  activatedBaseline: number,
  totalBaseline: number,
): ActivationRateDay[] => {
  const activationMap = new Map<string, number>();
  for (const row of activationRows) activationMap.set(row.date, row.count);

  const signupMap = new Map<string, number>();
  for (const row of signupRows) signupMap.set(row.date, row.count);

  const result: ActivationRateDay[] = [];
  let cumulativeActivated = activatedBaseline;
  let cumulativeTotal = totalBaseline;

  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  while (current <= end) {
    const key = toIsoDate(current);
    cumulativeActivated += activationMap.get(key) || 0;
    cumulativeTotal += signupMap.get(key) || 0;

    const rate = cumulativeTotal > 0 ? Math.round((cumulativeActivated / cumulativeTotal) * 1000) / 10 : 0;

    result.push({
      date: formatDayLabel(current),
      isoDate: key,
      rate,
      activated: cumulativeActivated,
      total: cumulativeTotal,
    });

    current.setDate(current.getDate() + 1);
  }

  return result;
};

export const getActivationRateData = async (
  startDate: Date,
  endDate: Date,
  granularity: 'daily' | 'monthly' = 'monthly',
): Promise<ActivationRateResponse> => {
  // Baselines: counts before the date range
  const activatedBaselinePromise = prisma.creator.count({
    where: {
      formCompletedAt: { not: null, lt: startDate },
      user: { role: 'creator', status: { in: ['active', 'pending'] } },
    },
  });

  const totalBaselinePromise = prisma.user.count({
    where: {
      role: 'creator',
      status: { in: ['active', 'pending'] },
      createdAt: { lt: startDate },
    },
  });

  if (granularity === 'daily') {
    const [dailyActivations, dailySignups, activatedBaseline, totalBaseline] = await Promise.all([
      prisma.$queryRaw<DailySignupRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS count
        FROM "Creator" c
        INNER JOIN "User" u ON u.id = c."userId"
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND c."formCompletedAt" IS NOT NULL
          AND c."formCompletedAt" >= (${startDate} AT TIME ZONE 'UTC')
          AND c."formCompletedAt" <= (${endDate} AT TIME ZONE 'UTC')
        GROUP BY DATE_TRUNC('day', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
        ORDER BY 1
      `,
      prisma.$queryRaw<DailySignupRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS count
        FROM "User" u
        INNER JOIN "Creator" c ON c."userId" = u.id
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND u."createdAt" >= (${startDate} AT TIME ZONE 'UTC')
          AND u."createdAt" <= (${endDate} AT TIME ZONE 'UTC')
        GROUP BY DATE_TRUNC('day', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
        ORDER BY 1
      `,
      activatedBaselinePromise,
      totalBaselinePromise,
    ]);

    const activationRate = fillActivationDayGaps(
      dailyActivations,
      dailySignups,
      startDate,
      endDate,
      activatedBaseline,
      totalBaseline,
    );

    // Period comparison: rate at end of current vs previous period
    const prevEnd = new Date(startDate.getTime() - 1);

    const [prevActivated, prevTotal] = await Promise.all([
      prisma.creator.count({
        where: {
          formCompletedAt: { not: null, lte: prevEnd },
          user: { role: 'creator', status: { in: ['active', 'pending'] } },
        },
      }),
      prisma.user.count({
        where: {
          role: 'creator',
          status: { in: ['active', 'pending'] },
          createdAt: { lte: prevEnd },
        },
      }),
    ]);

    const currentRate = activationRate.length > 0 ? activationRate[activationRate.length - 1].rate : 0;
    const previousRate = prevTotal > 0 ? Math.round((prevActivated / prevTotal) * 1000) / 10 : 0;
    const percentChange = Math.round((currentRate - previousRate) * 10) / 10;

    return {
      granularity: 'daily',
      activationRate,
      periodComparison: { currentRate, previousRate, percentChange },
    };
  }

  // --- Monthly granularity (default) ---
  const [monthlyActivations, monthlySignups, activatedBaseline, totalBaseline] = await Promise.all([
    prisma.$queryRaw<MonthlySignupRow[]>`
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
        EXTRACT(MONTH FROM DATE_TRUNC('month', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
        COUNT(*)::int AS count
      FROM "Creator" c
      INNER JOIN "User" u ON u.id = c."userId"
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND c."formCompletedAt" IS NOT NULL
        AND c."formCompletedAt" >= (${startDate} AT TIME ZONE 'UTC')
        AND c."formCompletedAt" <= (${endDate} AT TIME ZONE 'UTC')
      GROUP BY DATE_TRUNC('month', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1, 2
    `,
    prisma.$queryRaw<MonthlySignupRow[]>`
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
        EXTRACT(MONTH FROM DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
        COUNT(*)::int AS count
      FROM "User" u
      INNER JOIN "Creator" c ON c."userId" = u.id
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND u."createdAt" >= (${startDate} AT TIME ZONE 'UTC')
        AND u."createdAt" <= (${endDate} AT TIME ZONE 'UTC')
      GROUP BY DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1, 2
    `,
    activatedBaselinePromise,
    totalBaselinePromise,
  ]);

  const activationRate = fillActivationMonthGaps(
    monthlyActivations,
    monthlySignups,
    startDate,
    endDate,
    activatedBaseline,
    totalBaseline,
  );

  return {
    granularity: 'monthly',
    activationRate,
  };
};

// Time to Activation

interface TimeToActivationMonth {
  month: string;
  avgDays: number | null;
}

interface TimeToActivationDay {
  date: string;
  isoDate: string;
  avgDays: number | null;
}

interface MonthlyAvgDaysRow {
  year: number;
  month: number;
  avgdays: number;
}

interface DailyAvgDaysRow {
  date: string;
  avgdays: number;
}

interface TimeToActivationPeriodComparison {
  currentAvg: number | null;
  previousAvg: number | null;
  change: number | null;
}

interface TimeToActivationResponse {
  granularity: 'daily' | 'monthly';
  timeToActivation: TimeToActivationMonth[] | TimeToActivationDay[];
  periodComparison?: TimeToActivationPeriodComparison;
}

const fillTimeToActivationMonthGaps = (
  rows: MonthlyAvgDaysRow[],
  startDate: Date,
  endDate: Date,
): TimeToActivationMonth[] => {
  const avgMap = new Map<string, number>();
  for (const row of rows) {
    avgMap.set(`${row.year}-${row.month}`, row.avgdays);
  }

  const result: TimeToActivationMonth[] = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const key = `${year}-${month}`;

    const avgDays = avgMap.has(key) ? avgMap.get(key)! : null;

    result.push({
      month: formatMonthLabel(year, month),
      avgDays,
    });

    current.setMonth(current.getMonth() + 1);
  }

  return result;
};

const fillTimeToActivationDayGaps = (
  rows: DailyAvgDaysRow[],
  startDate: Date,
  endDate: Date,
): TimeToActivationDay[] => {
  const avgMap = new Map<string, number>();
  for (const row of rows) {
    avgMap.set(row.date, row.avgdays);
  }

  const result: TimeToActivationDay[] = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  while (current <= end) {
    const key = toIsoDate(current);
    const avgDays = avgMap.has(key) ? avgMap.get(key)! : null;

    result.push({
      date: formatDayLabel(current),
      isoDate: key,
      avgDays,
    });

    current.setDate(current.getDate() + 1);
  }

  return result;
};

export const getTimeToActivationData = async (
  startDate: Date,
  endDate: Date,
  granularity: 'daily' | 'monthly' = 'monthly',
): Promise<TimeToActivationResponse> => {
  if (granularity === 'daily') {
    const dailyAvgs = await prisma.$queryRaw<DailyAvgDaysRow[]>`
      SELECT
        TO_CHAR(DATE_TRUNC('day', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS date,
        ROUND(AVG(EXTRACT(EPOCH FROM (c."formCompletedAt" - u."createdAt")) / 86400)::numeric, 1) AS "avgdays"
      FROM "Creator" c
      INNER JOIN "User" u ON u.id = c."userId"
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND c."formCompletedAt" IS NOT NULL
        AND c."formCompletedAt" >= (${startDate} AT TIME ZONE 'UTC')
        AND c."formCompletedAt" <= (${endDate} AT TIME ZONE 'UTC')
      GROUP BY DATE_TRUNC('day', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1
    `;

    const timeToActivation = fillTimeToActivationDayGaps(dailyAvgs, startDate, endDate);

    // Period comparison: overall average of current vs previous period of same length
    const periodMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);

    const [currentAvgResult, previousAvgResult] = await Promise.all([
      prisma.$queryRaw<{ avgdays: number | null }[]>`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (c."formCompletedAt" - u."createdAt")) / 86400)::numeric, 1) AS "avgdays"
        FROM "Creator" c
        INNER JOIN "User" u ON u.id = c."userId"
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND c."formCompletedAt" IS NOT NULL
          AND c."formCompletedAt" >= (${startDate} AT TIME ZONE 'UTC')
          AND c."formCompletedAt" <= (${endDate} AT TIME ZONE 'UTC')
      `,
      prisma.$queryRaw<{ avgdays: number | null }[]>`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (c."formCompletedAt" - u."createdAt")) / 86400)::numeric, 1) AS "avgdays"
        FROM "Creator" c
        INNER JOIN "User" u ON u.id = c."userId"
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND c."formCompletedAt" IS NOT NULL
          AND c."formCompletedAt" >= (${prevStart} AT TIME ZONE 'UTC')
          AND c."formCompletedAt" <= (${prevEnd} AT TIME ZONE 'UTC')
      `,
    ]);

    const currentAvg = currentAvgResult[0]?.avgdays != null ? Number(currentAvgResult[0].avgdays) : null;
    const previousAvg = previousAvgResult[0]?.avgdays != null ? Number(previousAvgResult[0].avgdays) : null;
    const change =
      currentAvg != null && previousAvg != null ? Math.round((currentAvg - previousAvg) * 10) / 10 : null;

    return {
      granularity: 'daily',
      timeToActivation,
      periodComparison: { currentAvg, previousAvg, change },
    };
  }

  // --- Monthly granularity (default) ---
  const monthlyAvgs = await prisma.$queryRaw<MonthlyAvgDaysRow[]>`
    SELECT
      EXTRACT(YEAR FROM DATE_TRUNC('month', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
      EXTRACT(MONTH FROM DATE_TRUNC('month', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
      ROUND(AVG(EXTRACT(EPOCH FROM (c."formCompletedAt" - u."createdAt")) / 86400)::numeric, 1) AS "avgdays"
    FROM "Creator" c
    INNER JOIN "User" u ON u.id = c."userId"
    WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
      AND c."formCompletedAt" IS NOT NULL
      AND c."formCompletedAt" >= (${startDate} AT TIME ZONE 'UTC')
      AND c."formCompletedAt" <= (${endDate} AT TIME ZONE 'UTC')
    GROUP BY DATE_TRUNC('month', c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
    ORDER BY 1, 2
  `;

  const timeToActivation = fillTimeToActivationMonthGaps(monthlyAvgs, startDate, endDate);

  return {
    granularity: 'monthly',
    timeToActivation,
  };
};

// Time to Activation — Individual Creators for a period

interface TimeToActivationCreatorRow {
  userId: string;
  name: string;
  photoUrl: string | null;
  createdAt: Date;
  formCompletedAt: Date;
  daysToActivation: number;
}

export const getTimeToActivationCreators = async (startDate: Date, endDate: Date) => {
  // Use raw SQL with the same Asia/Kuala_Lumpur timezone conversion as the aggregated
  // query so that clicking a day/month in the chart returns the matching creators.
  const creators = await prisma.$queryRaw<TimeToActivationCreatorRow[]>`
    SELECT
      u.id AS "userId",
      u.name,
      u."photoURL" AS "photoUrl",
      u."createdAt",
      c."formCompletedAt",
      ROUND(EXTRACT(EPOCH FROM (c."formCompletedAt" - u."createdAt")) / 86400::numeric, 1) AS "daysToActivation"
    FROM "Creator" c
    INNER JOIN "User" u ON u.id = c."userId"
    WHERE u.role = 'creator'
      AND u.status IN ('active', 'pending')
      AND c."formCompletedAt" IS NOT NULL
      AND (c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= ${startDate}::date
      AND (c."formCompletedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')::date <= ${endDate}::date
    ORDER BY c."formCompletedAt" DESC
  `;

  const rows = creators.map((c) => ({
    ...c,
    daysToActivation: Number(c.daysToActivation),
  }));

  const avgDays =
    rows.length > 0 ? Math.round((rows.reduce((sum, r) => sum + r.daysToActivation, 0) / rows.length) * 10) / 10 : null;

  return { creators: rows, avgDays, count: rows.length };
};

// Pitch Rate — Creator drill-down (who first pitched in a date range)

interface PitchRateCreatorRow {
  userId: string;
  name: string;
  photoUrl: string | null;
  createdAt: Date;
  firstPitchAt: Date;
  daysToPitch: number;
}

export const getPitchRateCreators = async (startDate: Date, endDate: Date) => {
  const creators = await prisma.$queryRaw<PitchRateCreatorRow[]>`
    SELECT
      u.id AS "userId",
      u.name,
      u."photoURL" AS "photoUrl",
      u."createdAt",
      sub.first_pitch AS "firstPitchAt",
      ROUND(EXTRACT(EPOCH FROM (sub.first_pitch - u."createdAt")) / 86400::numeric, 1) AS "daysToPitch"
    FROM (
      SELECT p."userId", MIN(p."createdAt") AS first_pitch
      FROM "Pitch" p
      INNER JOIN "User" u ON u.id = p."userId"
      INNER JOIN "Creator" c ON c."userId" = u.id
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND p.status != 'draft'
      GROUP BY p."userId"
    ) sub
    INNER JOIN "User" u ON u.id = sub."userId"
    WHERE (sub.first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= ${startDate}::date
      AND (sub.first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')::date <= ${endDate}::date
    ORDER BY sub.first_pitch DESC
  `;

  const rows = creators.map((c) => ({
    ...c,
    daysToPitch: Number(c.daysToPitch),
  }));

  const avgDays =
    rows.length > 0 ? Math.round((rows.reduce((sum, r) => sum + r.daysToPitch, 0) / rows.length) * 10) / 10 : null;

  return { creators: rows, avgDays, count: rows.length };
};

// Pitch Rate

interface PitchRateResponse {
  granularity: 'daily' | 'monthly';
  pitchRate: ActivationRateMonth[] | ActivationRateDay[];
  periodComparison?: ActivationRatePeriodComparison;
}

export const getPitchRateData = async (
  startDate: Date,
  endDate: Date,
  granularity: 'daily' | 'monthly' = 'monthly',
): Promise<PitchRateResponse> => {
  // Baselines: counts before the date range
  // Pitched baseline: unique creators whose first non-draft pitch is before startDate
  const pitchedBaselineResult = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT p."userId", MIN(p."createdAt") AS first_pitch
      FROM "Pitch" p
      INNER JOIN "User" u ON u.id = p."userId"
      INNER JOIN "Creator" c ON c."userId" = u.id
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND p.status != 'draft'
      GROUP BY p."userId"
      HAVING MIN(p."createdAt") < ${startDate}
    ) sub
  `;
  const pitchedBaseline = pitchedBaselineResult[0]?.count ?? 0;

  // Total creator baseline (same as activation rate)
  const totalBaseline = await prisma.user.count({
    where: {
      role: 'creator',
      status: { in: ['active', 'pending'] },
      createdAt: { lt: startDate },
    },
  });

  if (granularity === 'daily') {
    // Daily pitch deltas: new first-time pitchers per day
    const [dailyPitches, dailySignups] = await Promise.all([
      prisma.$queryRaw<DailySignupRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS count
        FROM (
          SELECT p."userId", MIN(p."createdAt") AS first_pitch
          FROM "Pitch" p
          INNER JOIN "User" u ON u.id = p."userId"
          INNER JOIN "Creator" c ON c."userId" = u.id
          WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
            AND p.status != 'draft'
          GROUP BY p."userId"
        ) sub
        WHERE first_pitch >= ${startDate} AND first_pitch <= ${endDate}
        GROUP BY DATE_TRUNC('day', first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
        ORDER BY 1
      `,
      prisma.$queryRaw<DailySignupRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS count
        FROM "User" u
        INNER JOIN "Creator" c ON c."userId" = u.id
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND u."createdAt" >= (${startDate} AT TIME ZONE 'UTC')
          AND u."createdAt" <= (${endDate} AT TIME ZONE 'UTC')
        GROUP BY DATE_TRUNC('day', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
        ORDER BY 1
      `,
    ]);

    const pitchRate = fillActivationDayGaps(
      dailyPitches,
      dailySignups,
      startDate,
      endDate,
      pitchedBaseline,
      totalBaseline,
    );

    // Period comparison: rate at end of current vs previous period
    const prevEnd = new Date(startDate.getTime() - 1);

    const [prevPitchedResult, prevTotal] = await Promise.all([
      prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT p."userId", MIN(p."createdAt") AS first_pitch
          FROM "Pitch" p
          INNER JOIN "User" u ON u.id = p."userId"
          INNER JOIN "Creator" c ON c."userId" = u.id
          WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
            AND p.status != 'draft'
          GROUP BY p."userId"
          HAVING MIN(p."createdAt") <= ${prevEnd}
        ) sub
      `,
      prisma.user.count({
        where: {
          role: 'creator',
          status: { in: ['active', 'pending'] },
          createdAt: { lte: prevEnd },
        },
      }),
    ]);

    const prevPitched = prevPitchedResult[0]?.count ?? 0;
    const currentRate = pitchRate.length > 0 ? pitchRate[pitchRate.length - 1].rate : 0;
    const previousRate = prevTotal > 0 ? Math.round((prevPitched / prevTotal) * 1000) / 10 : 0;
    const percentChange = Math.round((currentRate - previousRate) * 10) / 10;

    return {
      granularity: 'daily',
      pitchRate,
      periodComparison: { currentRate, previousRate, percentChange },
    };
  }

  // --- Monthly granularity (default) ---
  const [monthlyPitches, monthlySignups] = await Promise.all([
    prisma.$queryRaw<MonthlySignupRow[]>`
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
        EXTRACT(MONTH FROM DATE_TRUNC('month', first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
        COUNT(*)::int AS count
      FROM (
        SELECT p."userId", MIN(p."createdAt") AS first_pitch
        FROM "Pitch" p
        INNER JOIN "User" u ON u.id = p."userId"
        INNER JOIN "Creator" c ON c."userId" = u.id
        WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
          AND p.status != 'draft'
        GROUP BY p."userId"
      ) sub
      WHERE first_pitch >= ${startDate} AND first_pitch <= ${endDate}
      GROUP BY DATE_TRUNC('month', first_pitch AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1, 2
    `,
    prisma.$queryRaw<MonthlySignupRow[]>`
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
        EXTRACT(MONTH FROM DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
        COUNT(*)::int AS count
      FROM "User" u
      INNER JOIN "Creator" c ON c."userId" = u.id
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND u."createdAt" >= (${startDate} AT TIME ZONE 'UTC')
        AND u."createdAt" <= (${endDate} AT TIME ZONE 'UTC')
      GROUP BY DATE_TRUNC('month', u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1, 2
    `,
  ]);

  const pitchRate = fillActivationMonthGaps(
    monthlyPitches,
    monthlySignups,
    startDate,
    endDate,
    pitchedBaseline,
    totalBaseline,
  );

  return {
    granularity: 'monthly',
    pitchRate,
  };
};

// Media Kit Activation — per-platform connection snapshot

export const getMediaKitActivationData = async (startDate?: Date, endDate?: Date) => {
  const baseWhere = {
    user: { role: 'creator' as const, status: { in: ['active' as const, 'pending' as const] } },
  };

  if (!startDate || !endDate) {
    // All-time snapshot using boolean flags
    const [tiktokConnected, instagramConnected, total, uniqueConnected] = await Promise.all([
      prisma.creator.count({ where: { ...baseWhere, isTiktokConnected: true } }),
      prisma.creator.count({ where: { ...baseWhere, isFacebookConnected: true } }),
      prisma.creator.count({ where: baseWhere }),
      prisma.creator.count({
        where: {
          ...baseWhere,
          OR: [{ isTiktokConnected: true }, { isFacebookConnected: true }],
        },
      }),
    ]);

    return {
      uniqueConnected,
      platforms: [
        { platform: 'TikTok', connected: tiktokConnected, total, rate: total > 0 ? Math.round((tiktokConnected / total) * 1000) / 10 : 0 },
        { platform: 'Instagram', connected: instagramConnected, total, rate: total > 0 ? Math.round((instagramConnected / total) * 1000) / 10 : 0 },
      ],
    };
  }

  // Date-filtered: count OAuth records created within range
  const [tiktokConnected, instagramConnected, total, uniqueConnectedResult] = await Promise.all([
    prisma.tiktokUser.count({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        creator: { user: { role: 'creator', status: { in: ['active', 'pending'] } } },
      },
    }),
    prisma.instagramUser.count({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        creator: { user: { role: 'creator', status: { in: ['active', 'pending'] } } },
      },
    }),
    prisma.creator.count({ where: baseWhere }), // Total is always ALL active creators
    prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(DISTINCT c.id)::int AS count
      FROM "Creator" c
      INNER JOIN "User" u ON u.id = c."userId"
      WHERE u.role = 'creator' AND u.status IN ('active', 'pending')
        AND (
          EXISTS (SELECT 1 FROM "TiktokUser" t WHERE t."creatorId" = c.id AND t."createdAt" >= ${startDate} AND t."createdAt" <= ${endDate})
          OR EXISTS (SELECT 1 FROM "InstagramUser" i WHERE i."creatorId" = c.id AND i."createdAt" >= ${startDate} AND i."createdAt" <= ${endDate})
        )
    `,
  ]);

  const uniqueConnected = uniqueConnectedResult?.[0]?.count ?? 0;

  return {
    uniqueConnected,
    platforms: [
      { platform: 'TikTok', connected: tiktokConnected, total, rate: total > 0 ? Math.round((tiktokConnected / total) * 1000) / 10 : 0 },
      { platform: 'Instagram', connected: instagramConnected, total, rate: total > 0 ? Math.round((instagramConnected / total) * 1000) / 10 : 0 },
    ],
  };
};

// Creator Satisfaction (NPS)

interface CreatorSatisfactionMonth {
  month: string;
  avgRating: number | null;
  count: number;
}

interface CreatorSatisfactionResponse {
  trend: CreatorSatisfactionMonth[];
  overall: {
    averageRating: number;
    totalResponses: number;
    distribution: { rating: number; count: number }[];
  };
}

interface MonthlyAvgRatingRow {
  year: number;
  month: number;
  avgRating: number;
  count: number;
}

const fillSatisfactionMonthGaps = (
  rows: MonthlyAvgRatingRow[],
  startDate: Date,
  endDate: Date,
): CreatorSatisfactionMonth[] => {
  const ratingMap = new Map<string, { avgRating: number; count: number }>();
  for (const row of rows) {
    ratingMap.set(`${row.year}-${row.month}`, { avgRating: Number(row.avgRating), count: row.count });
  }

  const result: CreatorSatisfactionMonth[] = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const key = `${year}-${month}`;
    const entry = ratingMap.get(key);

    result.push({
      month: formatMonthLabel(year, month),
      avgRating: entry ? entry.avgRating : null,
      count: entry ? entry.count : 0,
    });

    current.setMonth(current.getMonth() + 1);
  }

  return result;
};

export const getCreatorSatisfactionData = async (
  startDate: Date,
  endDate: Date,
): Promise<CreatorSatisfactionResponse> => {
  const [monthlyRatings, overallStats, distributionRows] = await Promise.all([
    prisma.$queryRaw<MonthlyAvgRatingRow[]>`
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS year,
        EXTRACT(MONTH FROM DATE_TRUNC('month', n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS month,
        ROUND(AVG(n.rating)::numeric, 1) AS "avgRating",
        COUNT(*)::int AS count
      FROM "NpsFeedback" n
      INNER JOIN "User" u ON u.id = n."userId"
      WHERE n."userType" = 'CREATOR'
        AND u.role = 'creator' AND u.status IN ('active', 'pending')
        AND n."createdAt" >= ${startDate}
        AND n."createdAt" <= ${endDate}
      GROUP BY DATE_TRUNC('month', n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')
      ORDER BY 1, 2
    `,
    prisma.$queryRaw<[{ total: number; avg: number | null }]>`
      SELECT COUNT(*)::int AS total, ROUND(AVG(rating)::numeric, 1) AS avg
      FROM "NpsFeedback"
      WHERE "userType" = 'CREATOR'
        AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
    `,
    prisma.$queryRaw<{ rating: number; count: number }[]>`
      SELECT rating, COUNT(*)::int AS count
      FROM "NpsFeedback"
      WHERE "userType" = 'CREATOR'
        AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
      GROUP BY rating ORDER BY rating
    `,
  ]);

  const trend = fillSatisfactionMonthGaps(monthlyRatings, startDate, endDate);

  // Fill missing ratings (1-5) with count 0
  const distMap = new Map<number, number>();
  for (const row of distributionRows) distMap.set(row.rating, row.count);
  const distribution = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: distMap.get(rating) || 0,
  }));

  const overall = {
    averageRating: overallStats[0]?.avg != null ? Number(overallStats[0].avg) : 0,
    totalResponses: overallStats[0]?.total ?? 0,
    distribution,
  };

  return { trend, overall };
};

// Shared demographics processing
function processDemographics(genderData: { pronounce: string | null }[], ageData: { birthDate: Date | null }[]) {
  const genderCounts = { Female: 0, Male: 0, Other: 0 };
  for (const { pronounce } of genderData) {
    const p = (pronounce || '').toLowerCase();
    if (p === 'she/her') {
      genderCounts.Female++;
    } else if (p === 'he/him') {
      genderCounts.Male++;
    } else {
      genderCounts.Other++;
    }
  }

  const gender: DemographicItem[] = [
    { label: 'Female', value: genderCounts.Female, color: '#E45DBF' },
    { label: 'Male', value: genderCounts.Male, color: '#1340FF' },
    { label: 'Other', value: genderCounts.Other, color: '#919EAB' },
  ];

  const ageBuckets: Record<string, number> = {
    '<18': 0,
    '18-25': 0,
    '26-35': 0,
    '36-45': 0,
    '45+': 0,
  };

  for (const { birthDate } of ageData) {
    if (!birthDate) continue;
    const age = calculateAge(birthDate);
    if (age < 18) ageBuckets['<18']++;
    else if (age <= 25) ageBuckets['18-25']++;
    else if (age <= 35) ageBuckets['26-35']++;
    else if (age <= 45) ageBuckets['36-45']++;
    else ageBuckets['45+']++;
  }

  const ageColors: Record<string, string> = {
    '<18': '#FFAB00',
    '18-25': '#919EAB',
    '26-35': '#00A76F',
    '36-45': '#00B8D9',
    '45+': '#FF5630',
  };

  const ageGroups: DemographicItem[] = Object.entries(ageBuckets).map(([label, value]) => ({
    label,
    value,
    color: ageColors[label],
  }));

  return { gender, ageGroups };
}
