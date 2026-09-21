import { Prisma } from '@prisma/client';

import { resolveGuestIdentity } from './guestProfileExtraction/guestIdentityService';

type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * Find or create the guest identity for a shortlisted non-platform creator.
 *
 * Identity now runs through `Creator.guestProfileKey`, which is unique. Two
 * links that name the same Instagram or TikTok creator resolve to one guest,
 * and two concurrent requests cannot create two guests. See
 * guestIdentityService for the legacy and conflict rules.
 */
export const handleGuestForShortListing = async (
  creator: any,
  tx: PrismaTransactionClient,
): Promise<{ userId: string; isGuest: boolean }> => {
  if (!creator.name || !creator.profileLink) {
    throw new Error(`Guest creator is missing required fields: ${JSON.stringify(creator)}`);
  }

  const resolved = await resolveGuestIdentity(tx, {
    name: creator.name,
    profileLink: creator.profileLink,
  });

  return { userId: resolved.userId, isGuest: resolved.isGuest };
};
