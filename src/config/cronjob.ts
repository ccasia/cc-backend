import { CronJob } from 'cron';

import { Entity, PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import LocalizedFormat from 'dayjs/plugin/localizedFormat';
import { Title, saveNotification } from '@controllers/notificationController';
import { notifications } from '@constants/reminders';
import { clients, io } from '../server';
import {
  reminderDueDate,
  escalationAgreementUnsigned,
  escalationDraftNotSubmitted,
  escalationPostingNotSubmitted,
} from '@helper/notification';
import { fetchInsightsForAllCampaigns } from '@services/insightFetchService';
import { capturePostEngagementSnapshots, captureDailyPostEngagement } from '@services/postEngagementSnapshotService';

const prisma = new PrismaClient();

dayjs.extend(LocalizedFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const mapping: any = {
  AGREEMENT_FORM: 'Agreement',
  FIRST_DRAFT: 'Draft',
  FINAL_DRAFT: 'Draft',
  POSTING: 'Posting',
};

new CronJob(
  '0 0 * * *', // cronTime
  async function () {
    const today = dayjs().tz('Asia/Kuala_Lumpur').startOf('day').toISOString();

    // Update campaign start date
    await prisma.campaign.updateMany({
      where: {
        campaignBrief: {
          startDate: {
            equals: today,
          },
        },
      },
      data: {
        status: 'ACTIVE',
      },
    });

    // Update campaign timeline status
    await prisma.campaignTimeline.updateMany({
      where: {
        endDate: {
          equals: today,
        },
      },
      data: {
        status: 'CLOSED',
      },
    });

    // Remind creator about due date
    const submissions = await prisma.submission.findMany({ include: { submissionType: true, campaign: true } });
    const dueDatesObject: any = notifications.level2.medium.find((item) => item.key === 'dueDates');

    submissions.map(async (submission) => {
      const startTrigger = dayjs(submission.dueDate).subtract(2, 'day');
      const today = dayjs();

      if (
        !submission.content &&
        (startTrigger.isBefore(today, 'date') || startTrigger.isSame(today, 'date')) &&
        today.isBefore(dayjs(submission.dueDate), 'date')
      ) {
        const { title, message } = reminderDueDate(
          submission.campaign.name,
          dayjs(submission.dueDate).format('D MMMM, YYYY'),
          mapping[submission.submissionType.type],
        ) as any;

        const data = await saveNotification({
          userId: submission.userId,
          entity: 'Timeline',
          message: message,
          title: title,
          entityId: submission.campaignId,
        });

        io.to(clients.get(submission.userId)).emit('notification', data);
      }
    });
  },
  null, // onComplete
  true, // start
  'Asia/Kuala_Lumpur', // timeZone
);

const AGREEMENT_ESCALATION_DAYS = [1, 2, 4, 7]; // days after agreement sent
const DRAFT_ESCALATION_DAYS = [3]; // days after the draft step became active (still unsubmitted)
const POSTING_ESCALATION_DAYS = [3]; // days after the posting step became active (still unsubmitted)

new CronJob(
  '0 9 * * *',
  async function () {
    const now = dayjs().tz('Asia/Kuala_Lumpur');
    const daysSince = (from: Date | null | undefined) =>
      from ? now.startOf('day').diff(dayjs(from).tz('Asia/Kuala_Lumpur').startOf('day'), 'day') : null;

    const notify = async (
      userId: string,
      campaignId: string,
      submissionId: string,
      built: { title: string; message: string },
    ) => {
      const data = await saveNotification({
        userId,
        entity: 'Timeline',
        message: built.message,
        title: built.title,
        entityId: campaignId,
        submissionId,
      });
      const socket = clients.get(userId);
      if (socket) io.to(socket).emit('notification', data);
    };

    try {
      // 1. Agreement Unsigned — agreement sent but AGREEMENT_FORM submission not yet signed.
      const agreements = await prisma.creatorAgreement.findMany({
        where: { isSent: true },
      });

      for (const agreement of agreements) {
        const elapsed = daysSince(agreement.completedAt);
        if (elapsed === null || !AGREEMENT_ESCALATION_DAYS.includes(elapsed)) continue;

        const submission = await prisma.submission.findFirst({
          where: {
            userId: agreement.userId,
            campaignId: agreement.campaignId,
            submissionType: { type: 'AGREEMENT_FORM' },
          },
          include: { campaign: { select: { name: true } } },
        });

        // Still unsigned = no content submitted and not yet approved.
        if (!submission || submission.content || submission.status === 'APPROVED') continue;

        await notify(
          agreement.userId,
          agreement.campaignId,
          submission.id,
          escalationAgreementUnsigned(submission.campaign.name),
        );
      }

      // 2. Draft not submitted (v4 VIDEO) — the creator still hasn't uploaded a draft.
      // v4 VIDEO submissions have no startDate/dueDate, so anchor on createdAt (when the
      // step became active = agreement approved).
      const pendingDrafts = await prisma.submission.findMany({
        where: {
          submissionVersion: 'v4',
          content: null,
          submissionType: { type: 'VIDEO' },
          status: 'NOT_STARTED',
        },
        include: { campaign: { select: { name: true } } },
      });

      for (const submission of pendingDrafts) {
        const elapsed = daysSince(submission.createdAt);
        if (elapsed === null || !DRAFT_ESCALATION_DAYS.includes(elapsed)) continue;

        await notify(
          submission.userId,
          submission.campaignId,
          submission.id,
          escalationDraftNotSubmitted(submission.campaign.name),
        );
      }

      // 3. Posting link not submitted (v4 VIDEO) — the video is approved but the creator
      // hasn't dropped the posting link yet (link is stored in `content`; adding it moves
      // the submission to APPROVE_LINK). Anchor on approvedAt (fallback updatedAt).
      const pendingPostingLinks = await prisma.submission.findMany({
        where: {
          submissionVersion: 'v4',
          content: null,
          submissionType: { type: 'VIDEO' },
          status: { in: ['APPROVED', 'CLIENT_APPROVED'] },
        },
        include: { campaign: { select: { name: true } } },
      });

      for (const submission of pendingPostingLinks) {
        const elapsed = daysSince(submission.approvedAt ?? submission.updatedAt);
        if (elapsed === null || !POSTING_ESCALATION_DAYS.includes(elapsed)) continue;

        await notify(
          submission.userId,
          submission.campaignId,
          submission.id,
          escalationPostingNotSubmitted(submission.campaign.name),
        );
      }
    } catch (error) {
      console.error('[Cronjob] Escalation reminders failed:', error);
    }
  },
  null, 
  true, 
  'Asia/Kuala_Lumpur',
);

// Daily insight collection cronjob - runs at 12 AM Asia/Kuala_Lumpur time
// Collects Instagram/TikTok metrics for all active campaigns with posting URLs
new CronJob(
  '0 0 * * *', // 12:00 AM daily
  async function () {
    console.log('[Cronjob] Starting daily insight collection at', dayjs().tz('Asia/Kuala_Lumpur').format());

    try {
      const result = await fetchInsightsForAllCampaigns();

      console.log('[Cronjob] Daily insight collection completed:', {
        processed: result.processed,
        success: result.success,
        failed: result.failed,
        timestamp: dayjs().tz('Asia/Kuala_Lumpur').format(),
      });
    } catch (error) {
      console.error('[Cronjob] Daily insight collection failed:', error);
    }
  },
  null, // onComplete
  true, // start
  'Asia/Kuala_Lumpur',
);

new CronJob(
  '0 1 * * *',
  async function () {
    console.log('[Cronjob] Starting post engagement snapshot collection at', dayjs().tz('Asia/Kuala_Lumpur').format());

    try {
      const result = await capturePostEngagementSnapshots();

      console.log('[Cronjob] Post engagement snapshot collection completed:', {
        processed: result.processed,
        captured: result.captured,
        skipped: result.skipped,
        failed: result.failed,
        timestamp: dayjs().tz('Asia/Kuala_Lumpur').format(),
      });
    } catch (error) {
      console.error('[Cronjob] Post engagement snapshot collection failed:', error);
    }

    try {
      const dailyResult = await captureDailyPostEngagement();

      console.log('[Cronjob] Daily post engagement collection completed:', {
        processed: dailyResult.processed,
        captured: dailyResult.captured,
        skipped: dailyResult.skipped,
        failed: dailyResult.failed,
        timestamp: dayjs().tz('Asia/Kuala_Lumpur').format(),
      });
    } catch (error) {
      console.error('[Cronjob] Daily post engagement collection failed:', error);
    }
  },
  null, // onComplete
  true, // start
  'Asia/Kuala_Lumpur',
);
