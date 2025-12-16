import dayjs from 'dayjs';
import { mapTimelineType } from '../utils/timelineTypeMapper';

/**
 * Validates and creates campaign timelines in the DB.
 * @param tx - Prisma transaction client
 * @param campaignId - Campaign ID
 * @param timeline - Timeline array from frontend
 */
export async function createCampaignTimelines(tx: any, campaignId: string, timeline: any[]) {
  if (!Array.isArray(timeline)) throw new Error('Timeline must be an array');
  for (const [index, item] of timeline.entries()) {
    if (!item.timeline_type || !item.timeline_type.name) {
      throw new Error(`Timeline step at index ${index} missing timeline_type.name`);
    }
    const type = mapTimelineType(item.timeline_type.name);
    const submission = await tx.submissionType.findFirst({ where: { type } });
    const timelineData: any = {
      for: item.for,
      duration: parseInt(item.duration),
      startDate: dayjs(item.startDate).toDate(),
      endDate: dayjs(item.endDate).toDate(),
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
