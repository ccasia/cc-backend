import { PrismaClient } from '@prisma/client';

export interface BlockedBrand {
  id: string;
  userId: string;
  brandId: string;
}

export interface BlockedBrandWithBrand extends BlockedBrand {
  brand: {
    id: string;
    name: string;
    logo: string | null;
  };
  blockedCampaignCount: number;
}

type BlockedBrandDelegate = Pick<PrismaClient['blockedBrand'], 'upsert' | 'findFirst' | 'delete' | 'findMany'>;
type CampaignDelegate = Pick<PrismaClient['campaign'], 'count'>;

interface PrismaLike {
  blockedBrand: BlockedBrandDelegate;
  campaign: CampaignDelegate;
}

const blockedBrandSelect = {
  id: true,
  userId: true,
  companyId: true,
} as const;

const toBlockedBrand = (row: { id: string; userId: string; companyId: string }): BlockedBrand => ({
  id: row.id,
  userId: row.userId,
  brandId: row.companyId,
});

export const blockBrand = async (
  prisma: PrismaLike,
  {
    userId,
    brandId,
  }: {
    userId: string;
    brandId: string;
  },
): Promise<BlockedBrand> => {
  const row = await prisma.blockedBrand.upsert({
    where: {
      userId_companyId: {
        userId,
        companyId: brandId,
      },
    },
    update: {},
    create: {
      userId,
      companyId: brandId,
    },
    select: blockedBrandSelect,
  });

  return toBlockedBrand(row);
};

export const unblockBrand = async (
  prisma: PrismaLike,
  {
    userId,
    brandId,
  }: {
    userId: string;
    brandId: string;
  },
): Promise<BlockedBrand | null> => {
  const blockedBrand = await prisma.blockedBrand.findFirst({
    where: {
      userId,
      companyId: brandId,
    },
    select: blockedBrandSelect,
  });

  if (!blockedBrand) return null;

  const row = await prisma.blockedBrand.delete({
    where: {
      id: blockedBrand.id,
    },
    select: blockedBrandSelect,
  });

  return toBlockedBrand(row);
};

export const getBlockedBrandIds = async (
  prisma: Pick<PrismaLike, 'blockedBrand'>,
  { userId }: { userId: string },
): Promise<string[]> => {
  const rows = await prisma.blockedBrand.findMany({
    where: { userId },
    select: { companyId: true },
  });

  return rows.map((row) => row.companyId);
};

export const getBlockedBrandsForUser = async (
  prisma: PrismaLike,
  { userId }: { userId: string },
): Promise<BlockedBrandWithBrand[]> => {
  const rows = await prisma.blockedBrand.findMany({
    where: { userId },
    include: {
      company: {
        select: { id: true, name: true, logo: true },
      },
    },
  });

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      userId: row.userId,
      brandId: row.companyId,
      brand: row.company,
      blockedCampaignCount: await prisma.campaign.count({
        where: { companyId: row.companyId, status: 'ACTIVE' },
      }),
    })),
  );
};
