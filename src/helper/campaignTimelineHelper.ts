import dayjs from 'dayjs';
import { mapTimelineType } from '../utils/timelineTypeMapper';

interface TimelineOptions {
  submissionVersion?: string;
  campaignStartDate?: Date;
  campaignEndDate?: Date;
  postingStartDate?: Date;
  postingEndDate?: Date;
  campaignType?: string;
}

/**
 * Creates campaign timelines for v4 campaigns based on campaign dates.
 * Uses proportional date calculation similar to activateClientCampaign.
 * @param tx - Prisma transaction client
 * @param campaignId - Campaign ID
 * @param options - Timeline options including dates
 */
async function createV4CampaignTimelines(tx: any, campaignId: string, options: TimelineOptions) {
  const { campaignStartDate, campaignEndDate, postingStartDate, postingEndDate, campaignType } = options;

  if (!campaignStartDate || !campaignEndDate) {
    throw new Error('Campaign start and end dates are required for v4 campaigns');
  }

  const startDate = new Date(campaignStartDate);
  const endDate = new Date(campaignEndDate);
  const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  // Ensure default submission types exist
  const submissionTypes = await tx.submissionType.findMany();
  if (!submissionTypes.length) {
    console.log('No submission types found, creating default ones');
    await tx.submissionType.createMany({
      data: [
        { type: 'AGREEMENT_FORM', description: 'Agreement Form' },
        { type: 'FIRST_DRAFT', description: 'First Draft' },
        { type: 'FINAL_DRAFT', description: 'Final Draft' },
        { type: 'POSTING', description: 'Posting' },
        { type: 'OTHER', description: 'Other' },
      ],
      skipDuplicates: true,
    });
  }

  // Get submission types
  const agreementFormType = await tx.submissionType.findFirst({ where: { type: 'AGREEMENT_FORM' } });
  const firstDraftType = await tx.submissionType.findFirst({ where: { type: 'FIRST_DRAFT' } });
  const finalDraftType = await tx.submissionType.findFirst({ where: { type: 'FINAL_DRAFT' } });
  const postingType = await tx.submissionType.findFirst({ where: { type: 'POSTING' } });

  if (!agreementFormType || !firstDraftType || !finalDraftType || !postingType) {
    console.error('Required submission types not found');
    throw new Error('Required submission types not found');
  }

  // Calculate proportional durations based on total campaign days
  const openForPitchDuration = Math.max(3, Math.floor(totalDays * 0.2));
  const agreementDuration = Math.max(2, Math.floor(totalDays * 0.1));
  const firstDraftDuration = Math.max(3, Math.floor(totalDays * 0.2));
  const finalDraftDuration = Math.max(3, Math.floor(totalDays * 0.2));

  // Calculate cumulative offsets for timeline phases
  const openForPitchEnd = new Date(startDate.getTime() + openForPitchDuration * 24 * 60 * 60 * 1000);
  const agreementEnd = new Date(startDate.getTime() + agreementDuration * 24 * 60 * 60 * 1000);
  const firstDraftStart = agreementEnd;
  const firstDraftEnd = new Date(firstDraftStart.getTime() + firstDraftDuration * 24 * 60 * 60 * 1000);
  const finalDraftStart = firstDraftEnd;
  const finalDraftEnd = new Date(finalDraftStart.getTime() + finalDraftDuration * 24 * 60 * 60 * 1000);

  // Use posting dates if provided, otherwise calculate from final draft end
  const validatedPostingStartDate = postingStartDate ? new Date(postingStartDate) : finalDraftEnd;
  const validatedPostingEndDate = postingEndDate ? new Date(postingEndDate) : endDate;

  const postingDuration = Math.max(
    1,
    Math.floor((validatedPostingEndDate.getTime() - validatedPostingStartDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  // Build timelines array - exclude Posting for UGC campaigns
  const isUgcCampaign = campaignType === 'ugc';

  const timelinesToCreate: any[] = [
    {
      name: 'Open For Pitch',
      for: 'creator',
      duration: openForPitchDuration,
      startDate: startDate,
      endDate: openForPitchEnd,
      order: 1,
      status: 'OPEN',
      campaignId,
    },
    {
      name: 'Agreement',
      for: 'creator',
      duration: agreementDuration,
      startDate: startDate,
      endDate: agreementEnd,
      order: 2,
      status: 'OPEN',
      campaignId,
      submissionTypeId: agreementFormType.id,
    },
    {
      name: 'First Draft',
      for: 'creator',
      duration: firstDraftDuration,
      startDate: firstDraftStart,
      endDate: firstDraftEnd,
      order: 3,
      status: 'OPEN',
      campaignId,
      submissionTypeId: firstDraftType.id,
    },
    {
      name: 'Final Draft',
      for: 'creator',
      duration: finalDraftDuration,
      startDate: finalDraftStart,
      endDate: finalDraftEnd,
      order: 4,
      status: 'OPEN',
      campaignId,
      submissionTypeId: finalDraftType.id,
    },
  ];

  // Add Posting timeline only for non-UGC campaigns
  if (!isUgcCampaign) {
    timelinesToCreate.push({
      name: 'Posting',
      for: 'creator',
      duration: postingDuration,
      startDate: validatedPostingStartDate,
      endDate: validatedPostingEndDate,
      order: 5,
      status: 'OPEN',
      campaignId,
      submissionTypeId: postingType.id,
    });
  }

  // Create all timelines
  console.log('Creating v4 campaign timelines...');
  for (const timeline of timelinesToCreate) {
    try {
      const createdTimeline = await tx.campaignTimeline.create({ data: timeline });
      console.log(`Successfully created v4 timeline: ${createdTimeline.name}`);
    } catch (error) {
      console.error(`Error creating v4 timeline ${timeline.name}:`, error);
      throw error;
    }
  }

  console.log('Successfully created all v4 campaign timelines');
}

/**
 * Creates campaign timelines for non-v4 campaigns from frontend timeline data.
 * If posting dates are provided in options, they will override the Posting timeline dates.
 * @param tx - Prisma transaction client
 * @param campaignId - Campaign ID
 * @param timeline - Timeline array from frontend
 * @param options - Timeline options including posting dates
 */
async function createDefaultCampaignTimelines(
  tx: any,
  campaignId: string,
  timeline: any[],
  options: TimelineOptions,
) {
  if (!Array.isArray(timeline)) throw new Error('Timeline must be an array');

  const { postingStartDate, postingEndDate } = options;

  for (const [index, item] of timeline.entries()) {
    if (!item.timeline_type || !item.timeline_type.name) {
      throw new Error(`Timeline step at index ${index} missing timeline_type.name`);
    }
    const type = mapTimelineType(item.timeline_type.name);
    const submission = await tx.submissionType.findFirst({ where: { type } });

    let itemStartDate = dayjs(item.startDate).toDate();
    let itemEndDate = dayjs(item.endDate).toDate();

    // If this is a Posting timeline and posting dates are provided, use them
    if (type === 'POSTING' && postingStartDate && postingEndDate) {
      itemStartDate = new Date(postingStartDate);
      itemEndDate = new Date(postingEndDate);
    }

    const timelineData: any = {
      for: item.for,
      duration: parseInt(item.duration),
      startDate: itemStartDate,
      endDate: itemEndDate,
      order: index + 1,
      name: item.timeline_type.name,
      campaign: { connect: { id: campaignId } },
    };
    if (submission && type !== 'OTHER') {
      timelineData.submissionType = { connect: { id: submission.id } };
    }
    await tx.campaignTimeline.create({ data: timelineData });
  }
}

/**
 * Validates and creates campaign timelines in the DB.
 * For v4 campaigns: Creates timelines with proportional date calculation based on campaign dates.
 * For non-v4 campaigns: Uses the timeline array from frontend, with posting dates override if provided.
 * @param tx - Prisma transaction client
 * @param campaignId - Campaign ID
 * @param timeline - Timeline array from frontend (used for non-v4 campaigns)
 * @param options - Optional timeline options (submissionVersion, campaign dates, etc.)
 */
export async function createCampaignTimelines(
  tx: any,
  campaignId: string,
  timeline: any[],
  options?: TimelineOptions,
) {
  const isV4Campaign = options?.submissionVersion === 'v4';

  if (isV4Campaign) {
    // For v4 campaigns, use the activateClientCampaign-style timeline creation
    await createV4CampaignTimelines(tx, campaignId, options);
  } else {
    // For non-v4 campaigns, use the default timeline from frontend with date validation
    await createDefaultCampaignTimelines(tx, campaignId, timeline, options || {});
  }
}