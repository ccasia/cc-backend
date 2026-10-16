import { CampaignStatus, LogisticType } from '@prisma/client';

export type UpdateSection = 'Shortlist' | 'Agreements' | 'Submissions' | 'Logistics' | 'Posting';

export interface PerformanceTotals {
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
}

export interface CampaignOverview {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    objective: string | null;
    keyArt: string | null;
    startDate: Date | null;
    endDate: Date | null;
    postingStartDate: Date | null;
    postingEndDate: Date | null;
  };
  credits: { total: number; used: number; unallocated: number };
  shortlist: { confirmed: number; contractPending: number; waitingOnClient: number; waitingSince: Date | null };
  submissions: {
    submissionVersion: string | null;
    approved: number;
    inReview: number;
    revision: number;
    notSubmitted: number;
    withAdmins: number;
    nextDueAt: Date | null;
  };
  logistics: {
    enabled: boolean;
    type: LogisticType | null;
    productsSetUp: boolean;
    delivered: number;
    inTransit: number;
    awaitingAssignment: number;
    issues: number;
    total: number;
  };
  posts: { live: number; pending: number; total: number };
  performance: (PerformanceTotals & { snapshotDate: Date; previous: PerformanceTotals | null }) | null;
  updates: { id: string; message: string; createdAt: Date; section: UpdateSection }[];
}
