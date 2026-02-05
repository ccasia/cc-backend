import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Check if the NPS modal should be shown to a client after a video action.
 * Triggers when the client has taken approve/request_changes actions on VIDEO submissions
 * for 3 or more unique creators globally, and hasn't already submitted NPS for the current
 * active subscription cycle.
 */
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

/**
 * Submit NPS feedback
 */
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

/**
 * Get paginated NPS feedback list for admin view
 */
export const getNpsFeedbackList = async (params: {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = params;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (search) {
    where.user = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    };
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
          },
        },
      },
    }),
    prisma.npsFeedback.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * Get NPS feedback summary statistics
 */
export const getNpsFeedbackStats = async () => {
  const [totalResponses, ratingAgg, distribution] = await Promise.all([
    prisma.npsFeedback.count(),
    prisma.npsFeedback.aggregate({
      _avg: { rating: true },
    }),
    // Get distribution per rating (1-5)
    Promise.all(
      [1, 2, 3, 4, 5].map(async (rating) => ({
        rating,
        count: await prisma.npsFeedback.count({ where: { rating } }),
      })),
    ),
  ]);

  return {
    totalResponses,
    averageRating: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(1)) : 0,
    distribution,
  };
};
