import { Prisma, Status } from '@prisma/client';

import type { CanonicalProfile } from '@/src/types/guestProfileExtraction';
import { normalizeProfileUrl } from './profileUrlNormalizer';

/**
 * Canonical identity for guest creators.
 *
 * `Creator.guestProfileKey` is unique, so two concurrent requests can never
 * create two guest identities for the same profile. A legacy group that maps
 * many creators onto one key is recorded in `GuestProfileIdentityConflict` and
 * blocks both extraction and creation until someone resolves it by hand.
 */

type Tx = Prisma.TransactionClient;

export class GuestIdentityConflictError extends Error {
  readonly code = 'GUEST_IDENTITY_CONFLICT';

  constructor(readonly canonicalProfileKey: string) {
    super(
      `The profile ${canonicalProfileKey} matches more than one existing guest creator. Resolve the conflict before adding this creator.`,
    );
    this.name = 'GuestIdentityConflictError';
  }
}

export interface ResolvedGuest {
  userId: string;
  isGuest: true;
  /** How the guest was found. Useful for logs and tests. */
  resolution: 'byCanonicalKey' | 'byLegacyLink' | 'created' | 'createdRace';
}

/** Throws when an unresolved legacy conflict blocks this identity. */
export async function assertNoIdentityConflict(tx: Tx, canonicalProfileKey: string): Promise<void> {
  const conflict = await tx.guestProfileIdentityConflict.findUnique({
    where: { canonicalProfileKey },
  });
  if (conflict && conflict.status === 'UNRESOLVED') {
    throw new GuestIdentityConflictError(canonicalProfileKey);
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

async function renameIfChanged(tx: Tx, userId: string, currentName: string | null, name: string): Promise<void> {
  if (currentName !== name) {
    await tx.user.update({ where: { id: userId }, data: { name } });
  }
}

/**
 * Find or create the guest identity for a canonical profile.
 *
 * The caller must already hold a transaction.
 */
export async function resolveGuestByCanonicalProfile(
  tx: Tx,
  input: { profile: CanonicalProfile; name: string; profileLink: string },
): Promise<ResolvedGuest> {
  const { profile, name, profileLink } = input;
  const { canonicalKey } = profile;

  await assertNoIdentityConflict(tx, canonicalKey);

  const byKey = await tx.creator.findFirst({
    where: { guestProfileKey: canonicalKey, isGuest: true },
    include: { user: true },
  });
  if (byKey) {
    await renameIfChanged(tx, byKey.userId, byKey.user?.name ?? null, name);
    return { userId: byKey.userId, isGuest: true, resolution: 'byCanonicalKey' };
  }

  // A legacy guest saved before the key existed. Adopt the key in place rather
  // than creating a second identity for the same creator.
  const byLink = await tx.creator.findFirst({
    where: { profileLink, isGuest: true, guestProfileKey: null },
    include: { user: true },
  });
  if (byLink) {
    try {
      await tx.creator.update({
        where: { id: byLink.id },
        data: { guestProfileKey: canonicalKey },
      });
      await renameIfChanged(tx, byLink.userId, byLink.user?.name ?? null, name);
      return { userId: byLink.userId, isGuest: true, resolution: 'byLegacyLink' };
    } catch (error) {
      // Another record already owns the key. Fall through and read it.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  try {
    const guestUser = await tx.user.create({
      data: {
        name,
        email: `guest_${Date.now()}_${Math.random()}@tempmail.com`,
        status: Status.guest,
        role: 'creator',
        creator: {
          create: {
            isGuest: true,
            profileLink,
            guestProfileKey: canonicalKey,
          },
        },
      },
    });
    return { userId: guestUser.id, isGuest: true, resolution: 'created' };
  } catch (error) {
    // The unique key turns a concurrent create into a read, not a duplicate.
    if (!isUniqueViolation(error)) throw error;

    const winner = await tx.creator.findFirst({
      where: { guestProfileKey: canonicalKey, isGuest: true },
    });
    if (!winner) throw error;
    return { userId: winner.userId, isGuest: true, resolution: 'createdRace' };
  }
}

/**
 * Legacy path for a link this backend cannot canonicalize.
 *
 * Matching stays on the raw link, exactly as before. Two links that differ by
 * a query string still make two guests here. That is unchanged behaviour, kept
 * so the separate manual mode continues to accept links outside Instagram and
 * TikTok.
 */
export async function resolveGuestByRawLink(
  tx: Tx,
  input: { name: string; profileLink: string },
): Promise<ResolvedGuest> {
  const { name, profileLink } = input;

  const existing = await tx.creator.findFirst({
    where: { profileLink, isGuest: true },
    include: { user: true },
  });
  if (existing) {
    await renameIfChanged(tx, existing.userId, existing.user?.name ?? null, name);
    return { userId: existing.userId, isGuest: true, resolution: 'byLegacyLink' };
  }

  const guestUser = await tx.user.create({
    data: {
      name,
      email: `guest_${Date.now()}_${Math.random()}@tempmail.com`,
      status: Status.guest,
      role: 'creator',
      creator: { create: { isGuest: true, profileLink } },
    },
  });
  return { userId: guestUser.id, isGuest: true, resolution: 'created' };
}

/**
 * Resolve a guest identity for any supplied link.
 *
 * A permitted Instagram or TikTok profile link uses the canonical key. Any
 * other link keeps the legacy raw-link behaviour.
 */
export async function resolveGuestIdentity(
  tx: Tx,
  input: { name: string; profileLink: string },
): Promise<ResolvedGuest> {
  const { name, profileLink } = input;
  if (!name || !profileLink) {
    throw new Error(`Guest creator is missing required fields: ${JSON.stringify(input)}`);
  }

  const normalized = normalizeProfileUrl(profileLink);
  if (normalized.ok) {
    return resolveGuestByCanonicalProfile(tx, { profile: normalized.profile, name, profileLink });
  }
  return resolveGuestByRawLink(tx, { name, profileLink });
}
