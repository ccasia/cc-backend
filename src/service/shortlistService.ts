import { Prisma, PrismaClient, Status } from '@prisma/client';

type PrismaTransactionClient = Prisma.TransactionClient;

export const handleGuestForShortListing = async (
  creator: any,
  tx: PrismaTransactionClient,
): Promise<{ userId: string; isGuest: boolean }> => {
  // Platform creator - return existing id
  if (!creator.name || !creator.profileLink) {
    throw new Error(`Guest creator is missing required fields: ${JSON.stringify(creator)}`);
  }

  // Non-platform creator - always create a new entry instead of reusing existing ones
  const guestCreator = await tx.user.create({
    data: {
      name: creator.name,
      email: `guest_${Date.now()}_${Math.random()}@tempmail.com`,
      guestProfileLink: creator.profileLink,
      status: Status.guest,
      role: 'creator',
      creator: { create: { isGuest: true } },
    },
  });

  return { userId: guestCreator.id, isGuest: true };
};
