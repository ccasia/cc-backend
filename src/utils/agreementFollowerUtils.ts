export type AgreementPlatform = 'instagram' | 'tiktok';

type FollowerSnapshot = {
  selectedPlatform?: string | null;
  followerCount?: unknown;
} | null;

type CreatorFollowerData = {
  manualInstagramFollowerCount?: unknown;
  manualTiktokFollowerCount?: unknown;
  instagramUser?: { followers_count?: unknown } | null;
  tiktokUser?: { follower_count?: unknown } | null;
} | null;

// Where the stored count came from. 'override' and 'seed' are the two cases the actor typed by
// hand, and are the only ones worth writing back onto the creator.
export type AgreementFollowerSource = 'override' | 'seed' | 'shortlist' | 'pitch' | 'manual' | 'social' | 'none';

export interface ResolvedAgreementFollowerCount {
  followerCount: number; // 0 when nothing is known for this platform
  source: AgreementFollowerSource;
  isActorProvided: boolean;
}

interface ResolveAgreementFollowerCountInput {
  actorRole?: string | null;
  requestedFollowerCount?: unknown;
  selectedPlatform: AgreementPlatform;
  shortlist?: FollowerSnapshot;
  pitch?: FollowerSnapshot;
  creator?: CreatorFollowerData;
}

// What resolvePlatform falls back to, and what the agreement dialog shows for a row that has no
// platform recorded. Snapshots written before selectedPlatform existed are read as this platform.
export const DEFAULT_AGREEMENT_PLATFORM: AgreementPlatform = 'instagram';

export const canOverrideAgreementFollowerCount = (role?: string | null): boolean => role === 'superadmin';

export const parsePositiveFollowerCount = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  const rawValue = String(value ?? '').trim();
  if (!rawValue || rawValue.startsWith('-')) return null;

  const parsed = Number.parseInt(rawValue.replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Rows written before selectedPlatform existed carry no platform, and both resolvePlatform and the
// agreement dialog present those as Instagram. Read them the same way rather than discarding the
// count the campaign actually agreed - dropping it silently re-prices the creator from live socials.
const getSnapshotFollowerCount = (
  snapshot: FollowerSnapshot | undefined,
  selectedPlatform: AgreementPlatform,
): number | null => {
  if (!snapshot) return null;
  if ((snapshot.selectedPlatform ?? DEFAULT_AGREEMENT_PLATFORM) !== selectedPlatform) return null;
  return parsePositiveFollowerCount(snapshot.followerCount);
};

// A connected account outranks a manual entry, the way getFollowerCountByPlatform in
// creditTierService does it. That helper stops at a connected account even when it reports 0; we
// keep looking, because a count of 0 is not something an agreement can be priced from.
const getConnectedFollowerCount = (
  creator: CreatorFollowerData | undefined,
  selectedPlatform: AgreementPlatform,
): number | null =>
  selectedPlatform === 'tiktok'
    ? parsePositiveFollowerCount(creator?.tiktokUser?.follower_count)
    : parsePositiveFollowerCount(creator?.instagramUser?.followers_count);

const getManualFollowerCount = (
  creator: CreatorFollowerData | undefined,
  selectedPlatform: AgreementPlatform,
): number | null =>
  selectedPlatform === 'tiktok'
    ? parsePositiveFollowerCount(creator?.manualTiktokFollowerCount)
    : parsePositiveFollowerCount(creator?.manualInstagramFollowerCount);

export const resolveAgreementFollowerCount = ({
  actorRole,
  requestedFollowerCount,
  selectedPlatform,
  shortlist,
  pitch,
  creator,
}: ResolveAgreementFollowerCountInput): ResolvedAgreementFollowerCount => {
  const requested = parsePositiveFollowerCount(requestedFollowerCount);

  // A superadmin's entry outranks everything already on file.
  if (canOverrideAgreementFollowerCount(actorRole) && requested) {
    return { followerCount: requested, source: 'override', isActorProvided: true };
  }

  const shortlistFollowerCount = getSnapshotFollowerCount(shortlist, selectedPlatform);
  if (shortlistFollowerCount) {
    return { followerCount: shortlistFollowerCount, source: 'shortlist', isActorProvided: false };
  }

  const pitchFollowerCount = getSnapshotFollowerCount(pitch, selectedPlatform);
  if (pitchFollowerCount) {
    return { followerCount: pitchFollowerCount, source: 'pitch', isActorProvided: false };
  }

  const connectedFollowerCount = getConnectedFollowerCount(creator, selectedPlatform);
  if (connectedFollowerCount) {
    return { followerCount: connectedFollowerCount, source: 'social', isActorProvided: false };
  }

  const manualFollowerCount = getManualFollowerCount(creator, selectedPlatform);
  if (manualFollowerCount) {
    return { followerCount: manualFollowerCount, source: 'manual', isActorProvided: false };
  }

  // Nothing is on file for this platform, so there is nothing for the actor to overwrite. Any
  // admin may supply the number - a creator who never linked the account they are being booked
  // on has no other source, and a credit tier campaign cannot be priced without one.
  if (requested) {
    return { followerCount: requested, source: 'seed', isActorProvided: true };
  }

  return { followerCount: 0, source: 'none', isActorProvided: false };
};

export const buildAgreementFollowerSnapshot = (
  followerCount: number,
  { platformChanged }: { platformChanged: boolean },
): {
  shortlistData: { followerCount?: number | null };
  pitchData: { followerCount?: string | null };
} => {
  const resolved = parsePositiveFollowerCount(followerCount);

  if (resolved) {
    return {
      shortlistData: { followerCount: resolved },
      pitchData: { followerCount: String(resolved) },
    };
  }

  // Moving the agreement onto a platform we know nothing about drops the old platform's campaign
  // snapshot. Pitch.followerCount is not that snapshot - it is the free-text count the admin typed
  // when sourcing the creator, which swapCreatorController and pitchController still read - so it
  // survives. Reads of it are already platform-gated above.
  if (platformChanged) {
    return {
      shortlistData: { followerCount: null },
      pitchData: {},
    };
  }

  return { shortlistData: {}, pitchData: {} };
};
