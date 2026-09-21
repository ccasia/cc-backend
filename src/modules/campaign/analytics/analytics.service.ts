import { prisma } from '@/src/prisma/prisma';
import { getLatestCampaignPostEngagement } from '@/src/service/postEngagementSnapshotService';
import { table } from 'console';
import dayjs from 'dayjs';

export const getAnalytics = async (campaignId: string) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) throw new Error('Campaign not found.');

    const data = await getLatestCampaignPostEngagement(campaign.id);

    //   console.table(data);

    const [postingUrls, submissionPostingUrls, insightSnapshots, manualCreatorEntries, test] = await Promise.all([
      prisma.submission.findMany({
        where: {
          campaignId: campaign.id,
          submissionType: {
            type: 'POSTING',
          },
          content: { not: null },
        },
        select: {
          content: true,
        },
      }),
      prisma.submissionPostingUrl.findMany({
        where: {
          campaignId: campaign.id,
        },
      }),
      prisma.insightSnapshot.findMany({
        where: {
          campaignId: campaign.id,
        },
      }),
      prisma.manualCreatorEntry.findMany({
        where: {
          campaignId: campaign.id,
        },
      }),
      //   prisma.dailyPostEngagementSnapshot.findMany({
      //     where: {
      //       campaignId: campaign.id,
      //       views: { not: 0 },
      //       likes: { not: 0 },
      //       comments: { not: 0 },
      //     },
      //     select: {
      //       id: true,
      //       views: true,
      //       likes: true,
      //       comments: true,
      //       platform: true,
      //       userId: true,
      //     },
      //   }),
      prisma.dailyPostEngagementSnapshot.findMany({
        where: {
          campaignId: campaign.id,
        },

        orderBy: [
          {
            capturedAt: 'desc',
          },
        ],

        distinct: ['userId'],
      }),
      // prisma.dailyPostEngagementSnapshot.findMany({
      //   where: {
      // campaignId: campaign.id,
      //   views: { not: 0 },
      //   likes: { not: 0 },
      //   comments: { not: 0 },
      //   },
      //   select: {
      //   id: true,
      //   views: true,
      //   likes: true,
      //   comments: true,
      //   platform: true,
      //   },
      //   orderBy: {
      //     capturedAt: 'desc',
      //   },
      // }),
    ]);

    //   console.table(postingUrls);
    //   table(submissionPostingUrls);

    console.table(insightSnapshots);

    let tiktok = 0;
    let instagram = 0;

    for (const { content } of postingUrls) {
      if (content?.match(/(instagram)/) && content?.match(/(tiktok)/)) {
        tiktok += 1;
        instagram += 1;
      } else if (content?.match(/tiktok/)) {
        tiktok += 1;
      } else if (content?.match(/instagram/)) {
        instagram += 1;
      }
    }

    console.log(tiktok, instagram);

    return 'Campaign found.';
  } catch (error) {
    console.log(error);
  }
};
