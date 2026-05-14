import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Statuses where credits are still escrowed against the subscription.
// COMPLETED / CANCELLED have already been refunded by closeCampaign.
const ACTIVE_CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'SCHEDULED', 'PENDING_CSM_REVIEW', 'PENDING_ADMIN_ACTIVATION'] as const;

type AllocationEntry = { subscriptionId: string; amount: number };

export interface DriftRow {
  subscriptionId: string;
  companyId: string | null;
  expected: number; // sum of allocations from active campaigns' breakdowns
  actual: number; // subscription.creditsUsed
  delta: number; // actual − expected (positive = over-allocated on the wallet)
}

export interface DriftReport {
  checked: number;
  drifted: DriftRow[];
  // Campaigns whose creditAllocationBreakdown is null/empty but campaignCredits > 0.
  // Legacy data — can't be verified by this detector. Reported separately so they don't
  // pollute the drift count.
  unverifiable: { campaignId: string; campaignCredits: number }[];
}

// Compares each ACTIVE subscription's creditsUsed against the sum of credits allocated to it
// across active campaigns (via campaign.creditAllocationBreakdown). Reports any mismatch.
// Read-only — never writes. Caller is responsible for logging/alerting.
export const detectCreditDrift = async (): Promise<DriftReport> => {
  const activeSubs = await prisma.subscription.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      companyId: true,
      creditsUsed: true,
    },
  });

  const activeCampaigns = await prisma.campaign.findMany({
    where: { status: { in: ACTIVE_CAMPAIGN_STATUSES as unknown as any[] } },
    select: {
      id: true,
      campaignCredits: true,
      creditAllocationBreakdown: true,
    },
  });

  const allocatedBySub = new Map<string, number>();
  const unverifiable: DriftReport['unverifiable'] = [];

  for (const campaign of activeCampaigns) {
    const breakdown = campaign.creditAllocationBreakdown as AllocationEntry[] | null;
    const credits = campaign.campaignCredits ?? 0;

    if (!breakdown || breakdown.length === 0) {
      if (credits > 0) {
        unverifiable.push({ campaignId: campaign.id, campaignCredits: credits });
      }
      continue;
    }

    for (const entry of breakdown) {
      if (!entry?.subscriptionId || typeof entry.amount !== 'number') continue;
      allocatedBySub.set(entry.subscriptionId, (allocatedBySub.get(entry.subscriptionId) ?? 0) + entry.amount);
    }
  }

  const drifted: DriftRow[] = [];

  for (const sub of activeSubs) {
    const expected = allocatedBySub.get(sub.id) ?? 0;
    const actual = sub.creditsUsed ?? 0;
    if (expected !== actual) {
      drifted.push({
        subscriptionId: sub.id,
        companyId: sub.companyId,
        expected,
        actual,
        delta: actual - expected,
      });
    }
  }

  return {
    checked: activeSubs.length,
    drifted,
    unverifiable,
  };
};

// Emits one structured WARNING per drifted subscription (consumable by GCP Cloud Logging's
// log-based alerts on tag=CreditDrift) and a single summary line per run.
export const runCreditDriftCheck = async (): Promise<DriftReport> => {
  const report = await detectCreditDrift();

  for (const row of report.drifted) {
    console.warn(
      JSON.stringify({
        severity: 'WARNING',
        tag: 'CreditDrift',
        message: 'Credit drift detected on subscription',
        subscriptionId: row.subscriptionId,
        companyId: row.companyId,
        expected: row.expected,
        actual: row.actual,
        delta: row.delta,
      }),
    );
  }

  if (report.unverifiable.length > 0) {
    console.warn(
      JSON.stringify({
        severity: 'NOTICE',
        tag: 'CreditDriftUnverifiable',
        message: 'Campaigns with credits but no allocation breakdown — cannot verify',
        count: report.unverifiable.length,
        sample: report.unverifiable.slice(0, 10),
      }),
    );
  }

  console.log(
    JSON.stringify({
      severity: report.drifted.length > 0 ? 'WARNING' : 'INFO',
      tag: 'CreditDriftSummary',
      message: 'Credit drift check complete',
      subscriptionsChecked: report.checked,
      driftedCount: report.drifted.length,
      unverifiableCount: report.unverifiable.length,
    }),
  );

  return report;
};
