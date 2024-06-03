import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

const router = Router();
const prisma = new PrismaClient();

router.post('/createCampaign', async (_req, res) => {
  try {
    const campaigns = await prisma.campaign.create({
      data: {
        name: 'CampaignC',
        status: 'active',
        userId: 'clwrauful0008z5z0wysv9gdj',
      },
    });

    const timeline = await prisma.timeline.createManyAndReturn({
      data: [
        {
          task_name: 'Opening for pitches',
          start_date: dayjs().format(),
          end_date: dayjs().add(6, 'day').format(),
        },
        {
          task_name: 'Shortlisting',
          start_date: dayjs().format(),
          end_date: dayjs().add(10, 'day').format(),
        },
      ],
    });

    for (const i in timeline) {
      await prisma.campaignTimeline.create({
        data: {
          timelineId: timeline[i].id,
          campaignId: campaigns.id,
        },
      });
    }
    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
});

export default router;
