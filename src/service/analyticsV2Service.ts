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
  date: string;    // "Feb 17" — display label
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
const formatDayLabel = (d: Date): string =>
  d.toLocaleString('en-US', { month: 'short', day: 'numeric' });

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
  baseline: number
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
    const growthRate = prevNewSignups > 0
      ? Math.round(((newSignups - prevNewSignups) / prevNewSignups) * 100 * 10) / 10
      : 0;

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
const fillDayGaps = (
  rows: DailySignupRow[],
  startDate: Date,
  endDate: Date,
  baseline: number
): CreatorGrowthDay[] => {
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

    const growthRate = prevNewSignups > 0
      ? Math.round(((newSignups - prevNewSignups) / prevNewSignups) * 100 * 10) / 10
      : 0;

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
  granularity: 'daily' | 'monthly' = 'monthly'
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

    const percentChange = previousPeriodSignups > 0
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

// Shared demographics processing
function processDemographics(
  genderData: { pronounce: string | null }[],
  ageData: { birthDate: Date | null }[]
) {
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
