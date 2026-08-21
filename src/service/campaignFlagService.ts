import { PrismaClient } from '@prisma/client';

export interface CampaignFlag {
  id: string;
  userId: string;
  campaignId: string;
  reason: string;
  details: string | null;
}

type CampaignFlagDelegate = Pick<PrismaClient['campaignFlag'], 'create'>;

interface PrismaLike {
  campaignFlag: CampaignFlagDelegate;
}

export const flagCampaign = async (
  prisma: PrismaLike,
  {
    userId,
    campaignId,
    reason,
    details,
  }: {
    userId: string;
    campaignId: string;
    reason: string;
    details?: string;
  },
): Promise<CampaignFlag> => {
  return prisma.campaignFlag.create({
    data: {
      userId,
      campaignId,
      reason,
      details: details || null,
    },
    select: {
      id: true,
      userId: true,
      campaignId: true,
      reason: true,
      details: true,
    },
  });
};
