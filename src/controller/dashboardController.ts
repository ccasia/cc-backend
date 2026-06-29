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
      totalCreatorsIncludingAll,
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

      // Total creators including NPCs (all statuses)
      prisma.user.count({
        where: {
          role: 'creator',
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
            OR: [{ isFacebookConnected: true }, { isTiktokConnected: true }],
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
        totalCreatorsIncludingAll,
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

/**
 * GET /api/dashboard/attention
 * Returns counts for items that need admin attention + avg response time
 */
export const getDashboardAttention = async (req: Request, res: Response) => {
  try {
    const [
      agreementsPendingReview,
      submissionsPendingReview,
      pitchesPendingReview,
      linksToApprove,
      clientFeedbacks,
      overdueInvoices,
      respondedPitches,
      clientRejectedCount,
      clientApprovedCount,
    ] = await Promise.all([
      // Agreements: matches what AgreementsPendingModal fetches
      prisma.submission.count({
        where: {
          status: 'PENDING_REVIEW',
          submissionType: { type: 'AGREEMENT_FORM' },
        },
      }),

      // Submissions (drafts): excludes agreement forms to avoid double-counting
      prisma.submission.count({
        where: {
          status: 'PENDING_REVIEW',
          submissionType: { type: { not: 'AGREEMENT_FORM' } },
        },
      }),

      prisma.pitch.count({
        where: {
          status: { in: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'] },
        },
      }),

      prisma.submission.count({
        where: { status: 'APPROVE_LINK' },
      }),

      prisma.submission.count({
        where: { status: 'CLIENT_FEEDBACK' },
      }),

      // Overdue invoices: matches OverdueInvoicesModal (only campaigns with admin assigned)
      prisma.invoice.count({
        where: {
          status: 'overdue',
          campaign: { campaignAdmin: { some: {} } },
        },
      }),

      prisma.pitch.findMany({
        where: {
          status: { notIn: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'] },
          completedAt: { not: null },
        },
        select: { createdAt: true, completedAt: true },
        take: 100,
        orderBy: { completedAt: 'desc' },
      }),

      // Submissions rejected/sent back by client
      prisma.submission.count({
        where: { status: { in: ['CLIENT_FEEDBACK', 'REJECTED', 'CHANGES_REQUIRED'] } },
      }),

      // Submissions approved by client
      prisma.submission.count({
        where: { status: { in: ['APPROVED', 'CLIENT_APPROVED', 'POSTED'] } },
      }),
    ]);

    let avgResponseHours = 0;
    if (respondedPitches.length > 0) {
      const totalHours = respondedPitches.reduce((sum, pitch) => {
        if (!pitch.completedAt) return sum;
        const diffMs = new Date(pitch.completedAt).getTime() - new Date(pitch.createdAt).getTime();
        return sum + diffMs / (1000 * 60 * 60);
      }, 0);
      avgResponseHours = Math.round((totalHours / respondedPitches.length) * 10) / 10;
    }

    const totalReviewed = clientRejectedCount + clientApprovedCount;
    const avgClientRejectionRate =
      totalReviewed > 0 ? Math.round((clientRejectedCount / totalReviewed) * 1000) / 10 : 0;

    return res.status(200).json({
      agreementsPendingReview,
      submissionsPendingReview,
      pitchesPendingReview,
      linksToApprove,
      clientFeedbacks,
      overdueInvoices,
      avgResponseHours,
      avgClientRejectionRate,
    });
  } catch (error: any) {
    console.error('Error fetching dashboard attention:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard attention data',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/newly-approved
 * Returns recently shortlisted creators whose agreements haven't been sent yet
 */
export const getDashboardNewlyApproved = async (req: Request, res: Response) => {
  try {
    const newlyApproved = await prisma.shortListedCreator.findMany({
      where: {
        isAgreementReady: false,
        userId: { not: null },
      },
      orderBy: { shortlisted_date: 'desc' },
      take: 20,
      select: {
        id: true,
        shortlisted_date: true,
        campaign: {
          select: { id: true, name: true },
        },
        user: {
          select: { id: true, name: true, photoURL: true },
        },
      },
    });

    return res.status(200).json(newlyApproved);
  } catch (error: any) {
    console.error('Error fetching newly approved creators:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch newly approved creators',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/agreements-pending
 * Returns agreement submissions that creators have signed and sent back (PENDING_REVIEW)
 * so admins can approve or reject them
 */
export const getDashboardAgreementsPending = async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: {
        status: 'PENDING_REVIEW',
        submissionType: {
          type: 'AGREEMENT_FORM',
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        campaignId: true,
        campaign: {
          select: { id: true, name: true },
        },
        user: {
          select: { id: true, name: true, photoURL: true },
        },
        dependencies: {
          select: {
            submissionId: true,
          },
        },
      },
    });

    return res.status(200).json(submissions);
  } catch (error: any) {
    console.error('Error fetching pending agreements:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending agreements',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/overdue-invoices
 * Returns overdue invoices for campaigns that have admin/CS assigned
 */
export const getDashboardOverdueInvoices = async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        status: 'overdue',
        campaign: {
          campaignAdmin: { some: {} },
        },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        dueDate: true,
        createdAt: true,
        campaignId: true,
        campaign: {
          select: { id: true, name: true },
        },
        creator: {
          select: {
            userId: true,
            user: {
              select: { id: true, name: true, photoURL: true },
            },
          },
        },
      },
    });

    return res.status(200).json(invoices);
  } catch (error: any) {
    console.error('Error fetching overdue invoices:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue invoices',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/client-feedbacks
 * Returns submissions with CLIENT_FEEDBACK status (v4 only)
 */
export const getDashboardClientFeedbacks = async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { status: 'CLIENT_FEEDBACK' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        updatedAt: true,
        userId: true,
        campaignId: true,
        submissionType: {
          select: { type: true },
        },
        campaign: {
          select: { id: true, name: true },
        },
        user: {
          select: { id: true, name: true, photoURL: true },
        },
      },
    });

    return res.status(200).json(submissions);
  } catch (error: any) {
    console.error('Error fetching client feedbacks:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch client feedbacks',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/links-pending
 * Returns posting link submissions waiting for admin approval (APPROVE_LINK)
 */
export const getDashboardLinksPending = async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { status: 'APPROVE_LINK' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        content: true,
        submissionVersion: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        campaignId: true,
        campaign: {
          select: { id: true, name: true, submissionVersion: true },
        },
        user: {
          select: { id: true, name: true, photoURL: true },
        },
      },
    });

    return res.status(200).json(submissions);
  } catch (error: any) {
    console.error('Error fetching links pending approval:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch links pending approval',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/pitches-pending
 * Returns pitches pending admin review
 */
export const getDashboardPitchesPending = async (req: Request, res: Response) => {
  try {
    const pitches = await prisma.pitch.findMany({
      where: {
        status: { in: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        campaignId: true,
        campaign: {
          select: { id: true, name: true },
        },
        user: {
          select: { id: true, name: true, photoURL: true },
        },
      },
    });

    return res.status(200).json(pitches);
  } catch (error: any) {
    console.error('Error fetching pending pitches:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending pitches',
      error: error.message,
    });
  }
};

/**
 * GET /api/dashboard/drafts-pending
 * Returns draft/video submissions pending admin review (excludes AGREEMENT_FORM type)
 */
export const getDashboardDraftsPending = async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: {
        status: 'PENDING_REVIEW',
        submissionType: {
          type: { not: 'AGREEMENT_FORM' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        campaignId: true,
        submissionType: {
          select: { type: true },
        },
        campaign: {
          select: { id: true, name: true, submissionVersion: true },
        },
        user: {
          select: { id: true, name: true, photoURL: true },
        },
      },
    });

    return res.status(200).json(submissions);
  } catch (error: any) {
    console.error('Error fetching pending drafts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending drafts',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/dashboard/agreements/:id
 * Rejects (deletes) a pending agreement
 */
export const deleteDashboardAgreement = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.creatorAgreement.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Agreement rejected and removed' });
  } catch (error: any) {
    console.error('Error deleting agreement:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete agreement',
      error: error.message,
    });
  }
};
