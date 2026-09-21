import { randomUUID } from 'crypto';

export type TreasureHuntClaimSource = 'IN_APP_CAMERA' | 'EXTERNAL_LINK';

export interface TreasureHuntParticipant {
  id: string;
  status: string;
  role: string;
  onboardingComplete: boolean;
}

export interface ResolvedTreasureHuntLocation {
  id: string;
  name: string;
  artworkUrl: string;
  isEnabled: boolean;
  hunt: {
    id: string;
    title: string;
    status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
    startsAt: Date;
    endsAt: Date;
    rewardXp: number;
  };
}

export interface TreasureHuntClaimSummary {
  id: string;
  source: TreasureHuntClaimSource;
  claimedAt: Date;
  location: {
    id: string;
    name: string;
    artworkUrl: string;
    hunt: {
      id: string;
      title: string;
      rewardXp: number;
    };
  };
  capture: { id: string; url?: string } | null;
  entryCount: number;
  globalXpTotal: number;
}

export interface StoredTreasureHuntCapture {
  objectPath: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
}

export interface CreateTreasureHuntClaimInput {
  claimId: string;
  userId: string;
  huntId: string;
  locationId: string;
  source: TreasureHuntClaimSource;
  capture: StoredTreasureHuntCapture | null;
}

export interface TreasureHuntRepository {
  getParticipant(userId: string): Promise<TreasureHuntParticipant | null>;
  resolveLocation(scanValue: string): Promise<ResolvedTreasureHuntLocation | null>;
  findClaim(userId: string, locationId: string): Promise<TreasureHuntClaimSummary | null>;
  createClaimWithXp(
    input: CreateTreasureHuntClaimInput,
  ): Promise<{ claim: TreasureHuntClaimSummary; awardedXp: number }>;
  getFeatured(userId: string, now: Date): Promise<unknown>;
  listHunts(userId: string): Promise<unknown>;
  getDetail(userId: string, huntId: string): Promise<unknown>;
  getCaptureAccess(userId: string, claimId: string): Promise<{ objectPath: string; accessedAsAdmin: boolean } | null>;
  getPreview(token: string, now: Date): Promise<unknown>;
}

export class TreasureHuntError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TreasureHuntError';
  }
}

export class TreasureHuntDuplicateClaimError extends Error {
  constructor() {
    super('Treasure hunt claim already exists.');
    this.name = 'TreasureHuntDuplicateClaimError';
  }
}

export const assertTreasureHuntLocationClaimable = (
  location: Pick<ResolvedTreasureHuntLocation, 'isEnabled' | 'hunt'>,
  claimedAt: Date,
) => {
  if (!location.isEnabled) {
    throw new TreasureHuntError(409, 'LOCATION_DISABLED', 'This hunt location is unavailable.');
  }

  if (location.hunt.status === 'PAUSED') {
    throw new TreasureHuntError(409, 'HUNT_PAUSED', 'This hunt is temporarily paused.');
  }

  const currentTime = claimedAt.getTime();
  if (location.hunt.status === 'DRAFT' || currentTime < location.hunt.startsAt.getTime()) {
    throw new TreasureHuntError(409, 'HUNT_NOT_STARTED', 'This hunt has not started yet.');
  }

  if (location.hunt.status === 'ARCHIVED' || currentTime >= location.hunt.endsAt.getTime()) {
    throw new TreasureHuntError(409, 'HUNT_ENDED', 'This hunt has ended.');
  }
};

export interface TreasureHuntCaptureStorage {
  storeCapture(input: {
    claimId: string;
    userId: string;
    locationId: string;
    data: Buffer;
    contentType: string;
  }): Promise<StoredTreasureHuntCapture>;
  deleteCapture(objectPath: string): Promise<void>;
  getCaptureUrl?(objectPath: string): Promise<string>;
}

interface RedeemInput {
  userId: string;
  scanValue: string;
  source: TreasureHuntClaimSource;
  capture?: {
    data: Buffer;
    contentType: string;
  };
}

export const createTreasureHuntService = ({
  repository,
  captureStorage,
  now = () => new Date(),
  createId = randomUUID,
}: {
  repository: TreasureHuntRepository;
  captureStorage?: TreasureHuntCaptureStorage;
  now?: () => Date;
  createId?: () => string;
}) => ({
  async preview(input: { token: string }) {
    const token = input.token.trim();
    if (!token || token.length > 512) {
      throw new TreasureHuntError(400, 'INVALID_LINK', 'This hunt link is invalid.');
    }

    const preview = await repository.getPreview(token, now());
    if (!preview) {
      throw new TreasureHuntError(404, 'INVALID_LINK', 'This hunt link is invalid.');
    }
    return preview;
  },

  async getCaptureUrl(input: { userId: string; claimId: string }) {
    const access = await repository.getCaptureAccess(input.userId, input.claimId);
    if (!access) {
      throw new TreasureHuntError(404, 'CAPTURE_NOT_FOUND', 'Capture not found.');
    }
    if (!captureStorage?.getCaptureUrl) {
      throw new TreasureHuntError(503, 'CAPTURE_STORAGE_UNAVAILABLE', 'Capture storage is unavailable.');
    }
    return captureStorage.getCaptureUrl(access.objectPath);
  },

  async list(input: { userId: string }) {
    const participant = await repository.getParticipant(input.userId);
    if (!participant || participant.status !== 'active') {
      throw new TreasureHuntError(403, 'ACCOUNT_NOT_ACTIVE', 'An active account is required.');
    }
    if (participant.role !== 'creator') {
      throw new TreasureHuntError(403, 'CREATOR_REQUIRED', 'A creator account is required.');
    }
    if (!participant.onboardingComplete) {
      throw new TreasureHuntError(403, 'ONBOARDING_INCOMPLETE', 'Complete onboarding before joining the hunt.');
    }
    return repository.listHunts(input.userId);
  },

  async getDetail(input: { userId: string; huntId: string }) {
    const participant = await repository.getParticipant(input.userId);
    if (!participant || participant.status !== 'active') {
      throw new TreasureHuntError(403, 'ACCOUNT_NOT_ACTIVE', 'An active account is required.');
    }
    if (participant.role !== 'creator') {
      throw new TreasureHuntError(403, 'CREATOR_REQUIRED', 'A creator account is required.');
    }
    if (!participant.onboardingComplete) {
      throw new TreasureHuntError(403, 'ONBOARDING_INCOMPLETE', 'Complete onboarding before joining the hunt.');
    }

    const detail = await repository.getDetail(input.userId, input.huntId);
    if (!detail) {
      throw new TreasureHuntError(404, 'HUNT_NOT_FOUND', 'This treasure hunt is not available.');
    }
    return detail;
  },

  async getFeatured(input: { userId: string }) {
    const participant = await repository.getParticipant(input.userId);
    if (!participant || participant.status !== 'active') {
      throw new TreasureHuntError(403, 'ACCOUNT_NOT_ACTIVE', 'An active account is required.');
    }
    if (participant.role !== 'creator') {
      throw new TreasureHuntError(403, 'CREATOR_REQUIRED', 'A creator account is required.');
    }
    if (!participant.onboardingComplete) {
      throw new TreasureHuntError(403, 'ONBOARDING_INCOMPLETE', 'Complete onboarding before joining the hunt.');
    }

    return repository.getFeatured(input.userId, now());
  },

  async redeem(input: RedeemInput) {
    const participant = await repository.getParticipant(input.userId);

    if (!participant || participant.status !== 'active') {
      throw new TreasureHuntError(403, 'ACCOUNT_NOT_ACTIVE', 'An active account is required.');
    }

    if (participant.role !== 'creator') {
      throw new TreasureHuntError(403, 'CREATOR_REQUIRED', 'A creator account is required.');
    }

    if (!participant.onboardingComplete) {
      throw new TreasureHuntError(403, 'ONBOARDING_INCOMPLETE', 'Complete onboarding before joining the hunt.');
    }

    const location = await repository.resolveLocation(input.scanValue);
    if (!location) {
      throw new TreasureHuntError(404, 'INVALID_TOKEN', 'This QR code is not valid.');
    }

    const existingClaim = await repository.findClaim(input.userId, location.id);
    if (existingClaim) {
      return {
        outcome: 'already_claimed' as const,
        awardedXp: 0,
        ...existingClaim,
      };
    }

    const claimedAt = now();
    assertTreasureHuntLocationClaimable(location, claimedAt);

    const claimId = createId();
    let storedCapture: StoredTreasureHuntCapture | null = null;

    // The in-app scan auto-captures a private frame, but the claim itself does
    // not depend on it: when no capture is supplied (or capture storage isn't
    // wired), the claim still succeeds and the collection falls back to the
    // canonical location artwork.
    if (input.source === 'IN_APP_CAMERA' && input.capture && captureStorage) {
      storedCapture = await captureStorage.storeCapture({
        claimId,
        userId: input.userId,
        locationId: location.id,
        data: input.capture.data,
        contentType: input.capture.contentType,
      });
    }

    try {
      const createdClaim = await repository.createClaimWithXp({
        claimId,
        userId: input.userId,
        huntId: location.hunt.id,
        locationId: location.id,
        source: input.source,
        capture: storedCapture,
      });

      return {
        outcome: 'claimed' as const,
        awardedXp: createdClaim.awardedXp,
        ...createdClaim.claim,
      };
    } catch (error) {
      if (storedCapture && captureStorage) {
        await captureStorage.deleteCapture(storedCapture.objectPath);
      }

      if (error instanceof TreasureHuntDuplicateClaimError) {
        const winningClaim = await repository.findClaim(input.userId, location.id);
        if (winningClaim) {
          return {
            outcome: 'already_claimed' as const,
            awardedXp: 0,
            ...winningClaim,
          };
        }
      }

      throw error;
    }
  },
});
