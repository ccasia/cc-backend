import { Request, Response } from 'express';
import { handleDeleteAdminById } from '@services/adminService';
import { Campaign, PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

export const deleteAdminById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await handleDeleteAdminById(id);
    return res.status(200).json({ message: 'Admin deleted.' });
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const getDashboardOverview = async (req: Request, res: Response) => {
  // const { id } = req.params;
  try {
    // const user = await prisma.user.findUnique({
    //   where: {
    //     id,
    //   },
    // });

    // if (!user) return res.status(404).json({ message: 'User not found' });

    const campaigns = await prisma.campaign.findMany({
      // where: {
      //   ...(user?.role !== 'superadmin' && {
      //     campaignAdmin: {
      //       some: {
      //         adminId: user.id,
      //       },
      //     },
      //   }),
      // },
    });

    const adjustedCampaigns = campaigns
      .sort((a, b) => (dayjs(a.createdAt) > dayjs(b.createdAt) ? 1 : -1))
      .map((campaign) => {
        const dateCreated = dayjs(campaign.createdAt).format('MMMM YYYY');

        return { ...campaign, createdAt: dateCreated };
      });

    const aggregatedResults = adjustedCampaigns.reduce((acc: any, curr: any) => {
      const found = acc.find((item: any) => item.month === curr.createdAt);

      if (found) {
        found.totalCampaigns += 1;
      } else {
        acc.push({ month: curr.createdAt, totalCampaigns: 0 });
      }

      return acc;
    }, []);

    const startOfCurrentWeek = dayjs().startOf('week');
    const startOfPreviousWeek = dayjs().subtract(1, 'week').startOf('week');
    const endOfPreviousWeek = dayjs().subtract(1, 'week').endOf('week');

    const getWeeklyData = async (): Promise<{ currentWeekCount: number; previousWeekCount: number }> => {
      const currentWeekCount = await prisma.campaign.count({
        where: {
          createdAt: {
            gte: startOfCurrentWeek.toDate(), // Greater than or equal to the start of current week
          },
        },
      });

      const previousWeekCount = await prisma.campaign.count({
        where: {
          createdAt: {
            gte: startOfPreviousWeek.toDate(), // Greater than or equal to the start of previous week
            lte: endOfPreviousWeek.toDate(), // Less than or equal to the end of previous week
          },
        },
      });

      return { currentWeekCount, previousWeekCount };
    };

    const data = await getWeeklyData();

    const percentageGrowth = data.previousWeekCount
      ? ((data.currentWeekCount - data.previousWeekCount) / data.previousWeekCount) * 100
      : data.currentWeekCount > 0
        ? 100
        : 0;

    const analytics = {
      campaigns: {
        percentageGrowth: percentageGrowth.toFixed(2),
        campaignsGraph: aggregatedResults,
      },
    };

    return res.status(200).json(analytics);
  } catch (error) {
    return res.status(400).json(error);
  }
};
