import { Request, Response } from 'express';
import { prisma } from '../prisma/prisma';

/**
 * Returns assigned campaign IDs for CS users.
 * Superadmins (god/advanced mode) get null, meaning no campaign filter applies.
 */
async function getAssignedCampaignIds(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      admin: {
        select: {
          mode: true,
          role: { select: { name: true } },
        },
      },
    },
  });

  const isSuperAdmin =
    user?.role === 'superadmin' || ['god', 'advanced'].includes(user?.admin?.mode || '');
  if (isSuperAdmin) return null;

  const assigned = await prisma.campaignAdmin.findMany({
    where: { adminId: userId },
    select: { campaignId: true },
  });

  return assigned.map((a) => a.campaignId);
}

/**
 * GET /api/dashboard/campaigns
 * Returns lightweight active campaigns data for dashboard.
 * CS users only see campaigns they are assigned to.
 */
export const getDashboardCampaigns = async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const limitNum = limit ? Math.min(parseInt(limit as string, 10) || 1000, 1000) : undefined;

    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
        ...(assignedIds !== null && { id: { in: assignedIds } }),
      },
      ...(limitNum && { take: limitNum }),
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
        _count: {
          select: {
            pitch: true,
            shortlisted: true,
          },
        },
        pitch: {
          where: {
            status: {
              in: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'],
            },
          },
          take: 10,
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

    const transformedCampaigns = campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      campaignCredits: campaign.campaignCredits,
      createdAt: campaign.createdAt,
      campaignBrief: campaign.campaignBrief,
      brand: campaign.brand,
      pitch: campaign.pitch,
      _count: {
        pitch: campaign._count.pitch,
        shortlisted: campaign._count.shortlisted,
      },
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
 * Returns aggregated dashboard statistics.
 * CS users only see stats scoped to their assigned campaigns.
 */
export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);
    const isFiltered = assignedIds !== null;

    const ids = assignedIds as string[];
    const campaignWhere = isFiltered ? { id: { in: ids } } : {};
    const pitchCampaignFilter = isFiltered ? { campaignId: { in: ids } } : {};

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
      prisma.user.count({
        where: {
          role: 'creator',
          status: 'active',
          ...(isFiltered && { shortlisted: { some: { campaignId: { in: assignedIds! } } } }),
        },
      }),

      prisma.user.count({
        where: {
          role: 'client',
          status: 'active',
          ...(isFiltered && {
            client: { campaignClients: { some: { campaignId: { in: assignedIds! } } } },
          }),
        },
      }),

      prisma.campaign.count({
        where: { status: 'ACTIVE', ...campaignWhere },
      }),

      prisma.campaign.count({
        where: { status: 'COMPLETED', ...campaignWhere },
      }),

      prisma.pitch.count({ where: pitchCampaignFilter }),

      prisma.pitch.count({
        where: {
          ...pitchCampaignFilter,
          status: { in: ['APPROVED', 'approved'] },
        },
      }),

      prisma.user.count({
        where: {
          role: 'creator',
          ...(isFiltered && { shortlisted: { some: { campaignId: { in: assignedIds! } } } }),
        },
      }),

      prisma.pitch.count({
        where: {
          ...pitchCampaignFilter,
          status: { in: ['PENDING_REVIEW', 'undecided', 'MAYBE', 'pending'] },
        },
      }),

      prisma.user.count({
        where: {
          role: 'creator',
          status: 'active',
          creator: {
            OR: [{ isFacebookConnected: true }, { isTiktokConnected: true }],
          },
          ...(isFiltered && { shortlisted: { some: { campaignId: { in: assignedIds! } } } }),
        },
      }),

      prisma.user.count({
        where: {
          role: 'creator',
          status: 'active',
          shortlisted: {
            some: isFiltered ? { campaignId: { in: assignedIds! } } : {},
          },
        },
      }),

      isFiltered ? Promise.resolve(0) : prisma.company.count(),
    ]);

    const maybePitches = await prisma.pitch.count({
      where: { ...pitchCampaignFilter, status: 'MAYBE' },
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
 * Returns counts for items needing attention + response/rejection metrics.
 * CS users only see items from their assigned campaigns.
 */
export const getDashboardAttention = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);
    const isFiltered = assignedIds !== null;

    const campaignIdFilter = isFiltered ? { campaignId: { in: assignedIds! } } : {};

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
      prisma.submission.count({
        where: {
          ...campaignIdFilter,
          status: 'PENDING_REVIEW',
          submissionType: { type: 'AGREEMENT_FORM' },
        },
      }),

      prisma.submission.count({
        where: {
          ...campaignIdFilter,
          status: 'PENDING_REVIEW',
          submissionType: { type: { not: 'AGREEMENT_FORM' } },
        },
      }),

      prisma.pitch.count({
        where: {
          ...campaignIdFilter,
          status: { in: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'] },
        },
      }),

      prisma.submission.count({
        where: { ...campaignIdFilter, status: 'APPROVE_LINK' },
      }),

      prisma.submission.count({
        where: { ...campaignIdFilter, status: 'CLIENT_FEEDBACK' },
      }),

      prisma.invoice.count({
        where: {
          status: 'overdue',
          campaign: {
            campaignAdmin: { some: {} },
            ...buildCampaignRelationFilter(assignedIds),
          },
        },
      }),

      prisma.pitch.findMany({
        where: {
          ...campaignIdFilter,
          status: { notIn: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'] },
          completedAt: { not: null },
        },
        select: { createdAt: true, completedAt: true },
        take: 100,
        orderBy: { completedAt: 'desc' },
      }),

      prisma.submission.count({
        where: {
          ...campaignIdFilter,
          status: { in: ['CLIENT_FEEDBACK', 'REJECTED', 'CHANGES_REQUIRED'] },
        },
      }),

      prisma.submission.count({
        where: {
          ...campaignIdFilter,
          status: { in: ['APPROVED', 'CLIENT_APPROVED', 'POSTED'] },
        },
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
 * Returns recently shortlisted creators whose agreements haven't been sent yet.
 * CS users only see creators from their assigned campaigns.
 */
export const getDashboardNewlyApproved = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const newlyApproved = await prisma.shortListedCreator.findMany({
      where: {
        isAgreementReady: false,
        userId: { not: null },
        ...(assignedIds !== null && { campaignId: { in: assignedIds } }),
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
 * Returns agreement submissions pending admin review.
 * CS users only see items from their assigned campaigns.
 */
export const getDashboardAgreementsPending = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const submissions = await prisma.submission.findMany({
      where: {
        status: 'PENDING_REVIEW',
        submissionType: { type: 'AGREEMENT_FORM' },
        ...(assignedIds !== null && { campaignId: { in: assignedIds } }),
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
 * Returns overdue invoices for campaigns that have admin/CS assigned.
 * CS users only see invoices from their assigned campaigns.
 */
export const getDashboardOverdueInvoices = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const invoices = await prisma.invoice.findMany({
      where: {
        status: 'overdue',
        campaign: {
          campaignAdmin: { some: {} },
          ...buildCampaignRelationFilter(assignedIds),
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
 * Returns submissions with CLIENT_FEEDBACK status.
 * CS users only see items from their assigned campaigns.
 */
export const getDashboardClientFeedbacks = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const submissions = await prisma.submission.findMany({
      where: {
        status: 'CLIENT_FEEDBACK',
        ...(assignedIds !== null && { campaignId: { in: assignedIds } }),
      },
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
 * Returns posting link submissions waiting for admin approval.
 * CS users only see items from their assigned campaigns.
 */
export const getDashboardLinksPending = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const submissions = await prisma.submission.findMany({
      where: {
        status: 'APPROVE_LINK',
        ...(assignedIds !== null && { campaignId: { in: assignedIds } }),
      },
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
 * Returns pitches pending admin review.
 * CS users only see pitches from their assigned campaigns.
 */
export const getDashboardPitchesPending = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const pitches = await prisma.pitch.findMany({
      where: {
        status: { in: ['undecided', 'PENDING_REVIEW', 'MAYBE', 'pending'] },
        ...(assignedIds !== null && { campaignId: { in: assignedIds } }),
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
 * Returns draft/video submissions pending admin review.
 * CS users only see items from their assigned campaigns.
 */
export const getDashboardDraftsPending = async (req: Request, res: Response) => {
  try {
    const assignedIds = await getAssignedCampaignIds(req.userId!);

    const submissions = await prisma.submission.findMany({
      where: {
        status: 'PENDING_REVIEW',
        submissionType: { type: { not: 'AGREEMENT_FORM' } },
        ...(assignedIds !== null && { campaignId: { in: assignedIds } }),
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

/** Builds a Prisma campaign relation filter from assigned campaign IDs. */
function buildCampaignRelationFilter(assignedIds: string[] | null) {
  return assignedIds !== null ? { id: { in: assignedIds } } : {};
}
