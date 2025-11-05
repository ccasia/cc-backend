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

  const existingGuest = await tx.user.findUnique({
    where: {
      guestProfileLink: creator.profileLink,
    },
    include: {
      creator: true,
    },
  });

  if (existingGuest) {
    if (!existingGuest.creator) {
      await tx.creator.create({
        data: {
          userId: existingGuest.id,
          isGuest: true,
        },
      });
    } else if (!existingGuest.creator.isGuest) {
      await tx.creator.update({
        where: { userId: existingGuest.id },
        data: { isGuest: true },
      });
    }

    if (existingGuest.name !== creator.name) {
      await tx.user.update({
        where: { id: existingGuest.id },
        data: { name: creator.name },
      });
    }

    return { userId: existingGuest.id, isGuest: true };
  }

  try {
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
  } catch (error: any) {
    if (error?.code === 'P2002' && error?.meta?.target?.includes('guestProfileLink')) {
      const existingUser = await tx.user.findUnique({
        where: {
          guestProfileLink: creator.profileLink,
        },
        include: {
          creator: true,
        },
      });

      if (existingUser) {
        if (!existingUser.creator) {
          await tx.creator.create({
            data: {
              userId: existingUser.id,
              isGuest: true,
            },
          });
        }

        return { userId: existingUser.id, isGuest: true };
      }
    }
    throw error;
  }
};
