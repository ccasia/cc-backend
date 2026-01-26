import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * GET /api/dashboard/stats
 * Returns aggregated dashboard statistics for superadmin
 * This endpoint optimizes performance by using database aggregations
 * instead of fetching all data and processing on the client
 */
export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    // Use Promise.all to fetch all metrics in parallel for better performance
    const [
      totalCreators,
      totalClients,
      activeCampaigns,
      completedCampaigns,
      totalPitches,
      approvedPitches,
      rejectedPitches,
      pendingPitches,
      creatorsWithMediaKit,
      creatorsInCampaigns,
      totalCompanies,
    ] = await Promise.all([
      // Total creators count
      prisma.user.count({
        where: {
          role: 'creator',
          status: 'active',
        },
      }),

      // Total clients count (users with client role)
      prisma.user.count({
        where: {
          role: 'client',
          status: 'active',
        },
      }),

      // Active campaigns count
      prisma.campaign.count({
        where: {
          status: 'ACTIVE',
        },
      }),

      // Completed campaigns count
      prisma.campaign.count({
        where: {
          status: 'COMPLETED',
        },
      }),

      // Total pitches count
      prisma.pitch.count(),

      // Approved pitches count
      prisma.pitch.count({
        where: {
          status: {
            in: ['APPROVED', 'approved'],
          },
        },
      }),

      // Rejected pitches count
      prisma.pitch.count({
        where: {
          status: {
            in: ['REJECTED', 'rejected'],
          },
        },
      }),

      // Pending pitches count
      prisma.pitch.count({
        where: {
          status: {
            in: ['PENDING_REVIEW', 'undecided', 'MAYBE', 'pending'],
          },
        },
      }),

      // Creators with media kit connected (has Instagram or TikTok account)
      prisma.user.count({
        where: {
          role: 'creator',
          status: 'active',
          creator: {
            OR: [
              { isFacebookConnected: true },
              { isTiktokConnected: true },
            ],
          },
        },
      }),

      // Creators who are in at least one campaign (have been shortlisted)
      prisma.user.count({
        where: {
          role: 'creator',
          status: 'active',
          shortlisted: {
            some: {},
          },
        },
      }),

      // Total companies count
      prisma.company.count(),
    ]);

    // Calculate additional metrics
    const maybePitches = await prisma.pitch.count({
      where: {
        status: 'MAYBE',
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        totalCreators,
        totalClients,
        totalCompanies,
        activeCampaigns,
        completedCampaigns,
        totalPitches,
        approvedPitches,
        rejectedPitches,
        pendingPitches,
        maybePitches,
        creatorsWithMediaKit,
        creatorsInCampaigns,
      },
    });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message,
    });
  }
};

