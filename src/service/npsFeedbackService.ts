import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Check if the NPS modal should be shown to a creator.
// Triggers when the creator has at least one completed campaign and hasn't already submitted NPS.
export const checkShouldShowCreatorNPS = async (creatorId: string): Promise<boolean> => {
  try {
    // 1. Has at least one completed campaign
    const completedCount = await prisma.shortListedCreator.count({
      where: { userId: creatorId, isCampaignDone: true },
    });
    if (completedCount === 0) return false;

    // 2. Has not already submitted creator NPS
    const existingNps = await prisma.npsFeedback.findFirst({
      where: { userId: creatorId, userType: 'CREATOR' },
    });
    return !existingNps;
  } catch (error) {
    console.error('Error checking creator NPS trigger:', error);
    return false;
  }
};

// Check if the NPS modal should be shown to a client after a video action.
//Triggers when the client has taken approve/request_changes actions on VIDEO submissions
//for 3 or more unique creators globally, and hasn't already submitted NPS for the current
//active subscription cycle.
export const checkShouldShowNPS = async (clientId: string): Promise<boolean> => {
  try {
    // 1. Count unique creators this client has given video feedback on
    const clientFeedbackRecords = await prisma.feedback.findMany({
      where: {
        adminId: clientId,
        submission: {
          submissionType: { type: 'VIDEO' },
          submissionVersion: 'v4',
        },
      },
      select: {
        submission: {
          select: { userId: true },
        },
      },
    });

    const uniqueCreatorIds = new Set(clientFeedbackRecords.map((f) => f.submission.userId));
    const uniqueCreatorCount = uniqueCreatorIds.size;

    if (uniqueCreatorCount < 3) {
      return false;
    }

    // 2. Get the client's company's active subscriptions
    const client = await prisma.client.findFirst({
      where: { userId: clientId },
      include: {
        company: {
          include: {
            subscriptions: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    const activeSubscriptions = client?.company?.subscriptions || [];

    // No active subscriptions — don't trigger NPS
    if (activeSubscriptions.length === 0) {
      return false;
    }

    // 3. Check if NPS was already submitted after the earliest active subscription start
    const earliestActiveSub = activeSubscriptions[0];

    const existingNps = await prisma.npsFeedback.findFirst({
      where: {
        userId: clientId,
        userType: 'CLIENT',
        createdAt: { gte: earliestActiveSub.createdAt },
      },
    });

    return !existingNps;
  } catch (error) {
    console.error('Error checking NPS trigger:', error);
    return false;
  }
};

// Submit NPS feedback
export const submitNpsFeedback = async (
  userId: string,
  userType: 'CLIENT' | 'CREATOR',
  rating: number,
  feedback?: string,
) => {
  return prisma.npsFeedback.create({
    data: {
      userId,
      userType,
      rating,
      feedback: feedback || null,
    },
  });
};

// Submit NPS feedback with role detection and duplicate check.
// Returns null if feedback was already submitted (for creators).
export const submitNpsFeedbackSafe = async (
  userId: string,
  rating: number,
  feedback?: string,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  const userType: 'CLIENT' | 'CREATOR' = user?.role === 'creator' ? 'CREATOR' : 'CLIENT';

  if (userType === 'CREATOR') {
    const existing = await prisma.npsFeedback.findFirst({
      where: { userId, userType: 'CREATOR' },
    });
    if (existing) return null;
  }

  return submitNpsFeedback(userId, userType, rating, feedback);
};

// Get paginated NPS feedback list for admin view
export const getNpsFeedbackList = async (params: {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  startDate?: string;
  endDate?: string;
  userType?: string;
  rating?: number;
}) => {
  const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc', startDate, endDate, userType, rating } = params;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (userType) {
    where.userType = userType;
  }

  if (search) {
    where.user = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  if (rating && rating >= 1 && rating <= 5) {
    where.rating = rating;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [data, total] = await Promise.all([
    prisma.npsFeedback.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoURL: true,
            country: true,
            creator: {
              select: {
                instagram: true,
                tiktok: true,
                tiktokUser: {
                  select: {
                    follower_count: true,
                    engagement_rate: true,
                  },
                },
                instagramUser: {
                  select: {
                    followers_count: true,
                    engagement_rate: true,
                  },
                },
              },
            },
            client: {
              select: {
                companyId: true,
                company: {
                  select: {
                    name: true,
                    logo: true,
                    campaign: {
                      select: {
                        id: true,
                        name: true,
                        status: true,
                        brand: {
                          select: { name: true },
                        },
                        campaignBrief: {
                          select: { images: true },
                        },
                      },
                      orderBy: { createdAt: 'desc' as const },
                      take: 3,
                    },
                    _count: {
                      select: { campaign: true },
                    },
                  },
                },
              },
            },
            shortlisted: {
              select: {
                id: true,
                isCampaignDone: true,
                campaign: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    brand: {
                      select: { name: true },
                    },
                    campaignBrief: {
                      select: { images: true },
                    },
                  },
                },
              },
              orderBy: { shortlisted_date: 'desc' as const },
              take: 3,
            },
            _count: {
              select: { shortlisted: true },
            },
          },
        },
      },
    }),
    prisma.npsFeedback.count({ where }),
  ]);

  return { data, total, page, limit };
};

// Get NPS feedback summary statistics
export const getNpsFeedbackStats = async (params?: { startDate?: string; endDate?: string; userType?: string }) => {
  const dateFilter: any = {};
  if (params?.startDate || params?.endDate) {
    dateFilter.createdAt = {};
    if (params.startDate) dateFilter.createdAt.gte = new Date(params.startDate);
    if (params.endDate) dateFilter.createdAt.lte = new Date(params.endDate);
  }
  if (params?.userType) {
    dateFilter.userType = params.userType;
  }

  const [totalResponses, ratingAgg, distribution, creatorCount, clientCount] = await Promise.all([
    prisma.npsFeedback.count({ where: dateFilter }),
    prisma.npsFeedback.aggregate({
      where: dateFilter,
      _avg: { rating: true },
    }),
    // Get distribution per rating (1-5)
    Promise.all(
      [1, 2, 3, 4, 5].map(async (rating) => ({
        rating,
        count: await prisma.npsFeedback.count({ where: { ...dateFilter, rating } }),
      })),
    ),
    // Only compute breakdown when not already filtered by userType
    !params?.userType
      ? prisma.npsFeedback.count({ where: { ...dateFilter, userType: 'CREATOR' } })
      : null,
    !params?.userType
      ? prisma.npsFeedback.count({ where: { ...dateFilter, userType: 'CLIENT' } })
      : null,
  ]);

  return {
    totalResponses,
    averageRating: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(1)) : 0,
    distribution,
    ...(creatorCount !== null && { creatorResponses: creatorCount }),
    ...(clientCount !== null && { clientResponses: clientCount }),
  };
};
