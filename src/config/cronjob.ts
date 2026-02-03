import { CronJob } from 'cron';

import { Entity, PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import LocalizedFormat from 'dayjs/plugin/localizedFormat';
import { Title, saveNotification } from '@controllers/notificationController';
import { notifications } from '@constants/reminders';
import { clients, io } from '../server';
import { reminderDueDate } from '@helper/notification';
import { fetchInsightsForAllCampaigns } from '@services/insightFetchService';

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
