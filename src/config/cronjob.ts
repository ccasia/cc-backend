import { CronJob } from 'cron';

import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import LocalizedFormat from 'dayjs/plugin/localizedFormat';

const prisma = new PrismaClient();

dayjs.extend(LocalizedFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

new CronJob(
  '0 0 * * *', // cronTime
  async function () {
    const today = dayjs().tz('Asia/Kuala_Lumpur').startOf('day').toISOString();

    // Find campaigns with the end date equal to today
    const campaigns = await prisma.campaign.findMany({
      where: {
        campaignBrief: {
          endDate: {
            equals: today,
          },
        },
      },
    });

    for (const campaign of campaigns) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'past' }, // or whatever status you need
      });
    }
  },
  null, // onComplete
  true, // start
  'Asia/Kuala_Lumpur', // timeZone
);
