export const CREATOR_CAMPAIGN_COMPLETED_EVENT = 'creator:campaign-completed';

export type CreatorCampaignCompletedAction = 'completed';

export interface CreatorCampaignCompletedPayload {
  userId: string;
  campaignId: string;
  action: CreatorCampaignCompletedAction;
  updatedAt: string;
}

export const createCreatorCampaignCompletedPayload = ({
  userId,
  campaignId,
  updatedAt = new Date().toISOString(),
}: {
  userId: string;
  campaignId: string;
  updatedAt?: string;
}): CreatorCampaignCompletedPayload => ({
  userId,
  campaignId,
  action: 'completed',
  updatedAt,
});
