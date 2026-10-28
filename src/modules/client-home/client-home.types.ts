import { CampaignStatus } from '@prisma/client';

export type ClientTaskType = 'SHORTLIST_REVIEW' | 'CONTENT_REVIEW';

/** 0 shortlist, 1 content review, 2 posting, 3 report/complete */
export type CampaignStage = 0 | 1 | 2 | 3;

export interface ClientHomeCredits {
  packageName: string | null;
  validUntil: Date | null;
  total: number;
  assigned: number;
  used: number;
}

export interface ClientHomeCampaign {
  id: string;
  name: string;
  objective: string | null;
  endDate: Date | null;
  logo: string | null;
  status: CampaignStatus;
  submissionVersion: string | null;
  stage: CampaignStage;
  credits: { used: number; assigned: number };
  shortlist: { confirmed: number; total: number };
  submissions: { received: number; approved: number };
  posting: { posted: number; total: number };
}

export interface ClientHomeTask {
  id: string;
  type: ClientTaskType;
  campaignId: string;
  title: string;
  detail: string;
  count: number;
  sentAt: Date;
  dueAt: Date;
}

export interface ClientHome {
  greetingName: string | null;
  credits: ClientHomeCredits;
  campaigns: ClientHomeCampaign[];
  tasks: ClientHomeTask[];
}
