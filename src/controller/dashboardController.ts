import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * GET /api/dashboard/campaigns
 * Returns lightweight active campaigns data for dashboard
 * Only fetches minimal data needed for display
 */
export const getDashboardCampaigns = async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    // Only apply limit if explicitly provided, otherwise fetch all active campaigns
    // Since we're only fetching minimal data, this should be performant
    const limitNum = limit ? Math.min(parseInt(limit as string, 10) || 1000, 1000) : undefined;

    // OPTIMIZED: Only fetch active campaigns with minimal nested data
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
      },
      ...(limitNum && { take: limitNum }), // Only apply take if limit is provided
      select: {
        id: true,
        name: true,
        status: true,
        campaignCredits: true,
        createdAt: true,
        campaignBrief: {
          select: {
            startDate: true,
            endDate: true,
            images: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            logo: true,
          },
        },
        // Only count pitches, don't fetch full data
        _count: {
          select: {
            pitch: true,
            shortlisted: true,
          },
        },
        // Only fetch minimal pitch data for pending pitches
        pitch: {
          where: {
            status: {
              in: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'],
            },
          },
          take: 10, // Limit to 10 pending pitches per campaign
          select: {
            id: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                photoURL: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform data to match frontend expectations
    const transformedCampaigns = campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      campaignCredits: campaign.campaignCredits,
      createdAt: campaign.createdAt,
      campaignBrief: campaign.campaignBrief,
      brand: campaign.brand,
      // Include pitch array (already filtered to pending by backend)
      pitch: campaign.pitch,
      // Include _count for pitch and shortlisted counts
      _count: {
        pitch: campaign._count.pitch,
        shortlisted: campaign._count.shortlisted,
      },
      // Also include shortlisted as array for compatibility (but empty since we don't need full data)
      shortlisted: [],
    }));

    return res.status(200).json(transformedCampaigns);
  } catch (error: any) {
    console.error('Error fetching dashboard campaigns:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard campaigns',
      error: error.message,
    });
  }
};

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

