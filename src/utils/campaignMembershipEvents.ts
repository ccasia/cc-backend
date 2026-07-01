export const CREATOR_CAMPAIGN_MEMBERSHIP_UPDATED_EVENT = 'creator:campaign-membership-updated';

export type CreatorCampaignMembershipAction = 'withdraw' | 'remove';

export interface CreatorCampaignMembershipUpdatedPayload {
  userId: string;
  campaignId: string;
  pitchId?: string;
  action: CreatorCampaignMembershipAction;
  updatedAt: string;
}

export const createCreatorCampaignMembershipUpdatedPayload = ({
  userId,
  campaignId,
  pitchId,
  action,
  updatedAt = new Date().toISOString(),
}: {
  userId: string;
  campaignId: string;
  pitchId?: string;
  action: CreatorCampaignMembershipAction;
  updatedAt?: string;
}): CreatorCampaignMembershipUpdatedPayload => ({
  userId,
  campaignId,
  ...(pitchId ? { pitchId } : {}),
  action,
  updatedAt,
});
