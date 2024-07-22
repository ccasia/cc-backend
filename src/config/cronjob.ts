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
    const campaignEnds = await prisma.campaign.updateMany({
      where: {
        campaignBrief: {
          endDate: {
            equals: today,
          },
        },
      },
      data: {
        status: 'completed',
      },
    });

    await prisma.campaign.updateMany({
      where: {
        campaignBrief: {
          startDate: {
            equals: today,
          },
        },
      },
      data: {
        status: 'active',
      },
    });
  },
  null, // onComplete
  true, // start
  'Asia/Kuala_Lumpur', // timeZone
);
