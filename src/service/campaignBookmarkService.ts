import { PrismaClient } from '@prisma/client';

export interface CampaignBookmark {
  id: string;
  userId: string;
  campaignId: string;
}

type BookmarkDelegate = Pick<PrismaClient['bookMarkCampaign'], 'upsert' | 'findFirst' | 'delete'>;

type PrismaLike = {
  bookMarkCampaign: BookmarkDelegate;
};

const bookmarkSelect = {
  id: true,
  userId: true,
  campaignId: true,
} as const;

export const saveCampaignBookmark = async (
  prisma: PrismaLike,
  {
    userId,
    campaignId,
  }: {
    userId: string;
    campaignId: string;
  },
): Promise<CampaignBookmark> => {
  return prisma.bookMarkCampaign.upsert({
    where: {
      userId_campaignId: {
        userId,
        campaignId,
      },
    },
    update: {},
    create: {
      userId,
      campaignId,
    },
    select: bookmarkSelect,
  });
};

export const unsaveCampaignBookmark = async (
  prisma: PrismaLike,
  {
    bookmarkId,
    userId,
  }: {
    bookmarkId: string;
    userId: string;
  },
): Promise<CampaignBookmark | null> => {
  const bookmark = await prisma.bookMarkCampaign.findFirst({
    where: {
      id: bookmarkId,
      userId,
    },
    select: bookmarkSelect,
  });

  if (!bookmark) return null;

  return prisma.bookMarkCampaign.delete({
    where: {
      id: bookmarkId,
    },
    select: bookmarkSelect,
  });
};
