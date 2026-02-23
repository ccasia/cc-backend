import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getCreatorGrowthData } from '@services/analyticsV2Service';

const prisma = new PrismaClient();

export const getCreatorGrowth = async (req: Request, res: Response) => {
  try {
    const { startDate: startParam, endDate: endParam, granularity: granParam } = req.query;
    const granularity = granParam === 'daily' ? 'daily' : 'monthly';

    let startDate: Date;
    let endDate: Date;

    if (startParam || endParam) {
      startDate = new Date(startParam as string);
      endDate = new Date(endParam as string);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use YYYY-MM-DD.',
        });
      }

      if (startDate >= endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate must be before endDate.',
        });
      }
    } else {
      if (granularity === 'daily') {
        return res.status(400).json({
          success: false,
          message: 'startDate and endDate are required for daily granularity.',
        });
      }

      // Default: from earliest creator signup to end of current month
      const now = new Date();
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); // End of current month

      const earliest = await prisma.user.findFirst({
        where: { role: 'creator', status: { in: ['active', 'pending'] }, creator: { isNot: null } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      if (earliest) {
        startDate = new Date(earliest.createdAt.getFullYear(), earliest.createdAt.getMonth(), 1);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    }

    const data = await getCreatorGrowthData(startDate, endDate, granularity);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('Error fetching creator growth data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch creator growth data',
      error: error.message,
    });
  }
};
