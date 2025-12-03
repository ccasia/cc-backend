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

  // Check if a guest creator already exists with this profile link on Creator model
  const existingCreatorWithProfileLink = await tx.creator.findFirst({
    where: {
      profileLink: creator.profileLink,
      isGuest: true,
    },
    include: {
      user: true,
    },
  });

  if (existingCreatorWithProfileLink) {
    // Update name if changed
    if (existingCreatorWithProfileLink.user.name !== creator.name) {
      await tx.user.update({
        where: { id: existingCreatorWithProfileLink.userId },
        data: { name: creator.name },
      });
    }

    return { userId: existingCreatorWithProfileLink.userId, isGuest: true };
  }

  try {
    // Create new guest user and creator with profileLink on Creator model
    const guestUser = await tx.user.create({
      data: {
        name: creator.name,
        email: `guest_${Date.now()}_${Math.random()}@tempmail.com`,
        status: Status.guest,
        role: 'creator',
        creator: {
          create: {
            isGuest: true,
            profileLink: creator.profileLink, // Store profile link on Creator model
          },
        },
      },
    });

    return { userId: guestUser.id, isGuest: true };
  } catch (error: any) {
    // Handle race condition - if another request created a creator with the same profile link
    if (error?.code === 'P2002') {
      const existingCreator = await tx.creator.findFirst({
        where: {
          profileLink: creator.profileLink,
          isGuest: true,
        },
      });

      if (existingCreator) {
        return { userId: existingCreator.userId, isGuest: true };
      }
    }
    throw error;
  }
};
