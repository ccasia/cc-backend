import { createHash } from 'crypto';

import {
  assertTreasureHuntLocationClaimable,
  CreateTreasureHuntClaimInput,
  TreasureHuntDuplicateClaimError,
  TreasureHuntError,
} from './treasureHuntService';
import { lockTreasureHunt, lockTreasureHuntLocation } from './treasureHuntDb';
import { awardXp } from '@/src/modules/gamification';

const locationSelect = {
  id: true,
  name: true,
  artworkUrl: true,
  isEnabled: true,
  hunt: {
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      rewardXp: true,
    },
  },
} as const;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const findClaimSummary = async (prisma: any, userId: string, locationId: string) => {
  const claim = await prisma.treasureHuntClaim.findUnique({
    where: { userId_locationId: { userId, locationId } },
    select: {
      id: true,
      source: true,
      claimedAt: true,
      capture: { select: { id: true } },
      location: {
        select: {
          id: true,
          name: true,
          artworkUrl: true,
          huntId: true,
          hunt: { select: { id: true, title: true, rewardXp: true } },
        },
      },
    },
  });

  if (!claim) return null;

  const [entryCount, xpBalance] = await Promise.all([
    prisma.treasureHuntClaim.count({
      where: { userId, location: { huntId: claim.location.huntId } },
    }),
    prisma.userXpBalance.findUnique({
      where: { userId },
      select: { total: true },
    }),
  ]);

  const { huntId: _huntId, ...location } = claim.location;
  return {
    ...claim,
    location,
    entryCount,
    globalXpTotal: xpBalance?.total ?? 0,
  };
};

export const createPrismaTreasureHuntRepository = ({
  prisma,
  canonicalHost,
  bitlyHosts = ['bit.ly'],
  now = () => new Date(),
}: {
  prisma: any;
  canonicalHost: string;
  bitlyHosts?: string[];
  now?: () => Date;
}) => {
  const repository = {
    async getPreview(token: string, now: Date) {
      if (!token || token.length > 512) return null;

      const location = await prisma.treasureHuntLocation.findUnique({
        where: { publicTokenHash: hashToken(token) },
        select: {
          name: true,
          artworkUrl: true,
          isEnabled: true,
          hunt: {
            select: {
              title: true,
              description: true,
              heroArtworkUrl: true,
              status: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
      });
      if (!location) return null;

      let availability = 'AVAILABLE';
      if (!location.isEnabled) availability = 'LOCATION_DISABLED';
      else if (location.hunt.status === 'PAUSED') availability = 'PAUSED';
      else if (location.hunt.status === 'DRAFT' || now < location.hunt.startsAt) availability = 'NOT_STARTED';
      else if (location.hunt.status === 'ARCHIVED' || now >= location.hunt.endsAt) availability = 'ENDED';

      const { status: _status, ...hunt } = location.hunt;
      return {
        availability,
        hunt,
        location: {
          name: location.name,
          artworkUrl: location.artworkUrl,
        },
      };
    },

    async getCaptureAccess(userId: string, claimId: string) {
      const claim = await prisma.treasureHuntClaim.findUnique({
        where: { id: claimId },
        select: {
          userId: true,
          locationId: true,
          location: { select: { huntId: true } },
          capture: { select: { objectPath: true } },
        },
      });
      if (!claim?.capture) return null;

      if (claim.userId === userId) {
        return { objectPath: claim.capture.objectPath, accessedAsAdmin: false };
      }

      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (requester?.role !== 'superadmin') return null;

      await prisma.treasureHuntAuditLog.create({
        data: {
          actorUserId: userId,
          huntId: claim.location.huntId,
          locationId: claim.locationId,
          action: 'CAPTURE_VIEWED',
          metadata: { claimId },
        },
      });

      return { objectPath: claim.capture.objectPath, accessedAsAdmin: true };
    },

    async getParticipant(userId: string) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          role: true,
          creator: { select: { isOnBoardingFormCompleted: true } },
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        status: user.status,
        role: user.role,
        onboardingComplete: user.creator?.isOnBoardingFormCompleted === true,
      };
    },

    async listHunts(userId: string) {
      const hunts = await prisma.treasureHunt.findMany({
        where: {
          OR: [{ status: 'PUBLISHED' }, { locations: { some: { claims: { some: { userId } } } } }],
        },
        orderBy: { startsAt: 'desc' },
        select: {
          id: true,
          title: true,
          heroArtworkUrl: true,
          startsAt: true,
          endsAt: true,
          rewardXp: true,
          status: true,
          locations: {
            where: { isEnabled: true },
            select: {
              id: true,
              claims: {
                where: { userId },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });

      return hunts.map((hunt: any) => {
        const { locations, ...summary } = hunt;
        return {
          ...summary,
          locationCount: locations.length,
          entryCount: locations.filter((location: any) => location.claims.length > 0).length,
        };
      });
    },

    async getDetail(userId: string, huntId: string) {
      const [hunt, xpBalance] = await Promise.all([
        prisma.treasureHunt.findFirst({
          where: {
            id: huntId,
            OR: [{ status: 'PUBLISHED' }, { locations: { some: { claims: { some: { userId } } } } }],
          },
          select: {
            id: true,
            title: true,
            description: true,
            heroArtworkUrl: true,
            startsAt: true,
            endsAt: true,
            rewardXp: true,
            status: true,
            locations: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                name: true,
                hint: true,
                sortOrder: true,
                artworkUrl: true,
                isEnabled: true,
                claims: {
                  where: { userId },
                  orderBy: { claimedAt: 'asc' },
                  take: 1,
                  select: {
                    id: true,
                    claimedAt: true,
                    capture: { select: { id: true } },
                  },
                },
              },
            },
          },
        }),
        prisma.userXpBalance.findUnique({
          where: { userId },
          select: { total: true },
        }),
      ]);

      if (!hunt) return null;

      const locations = hunt.locations.map((location: any) => {
        const claim = location.claims[0] ?? null;
        const { claims: _claims, ...item } = location;
        return {
          ...item,
          scanned: Boolean(claim),
          claimId: claim?.id ?? null,
          claimedAt: claim?.claimedAt ?? null,
          captureId: claim?.capture?.id ?? null,
        };
      });
      const { locations: _locations, ...summary } = hunt;

      return {
        ...summary,
        entryCount: locations.filter((location: any) => location.scanned).length,
        globalXpTotal: xpBalance?.total ?? 0,
        locations,
      };
    },

    async getFeatured(userId: string, now: Date) {
      const [hunt, xpBalance] = await Promise.all([
        prisma.treasureHunt.findFirst({
          where: {
            featuredSlot: 1,
            status: 'PUBLISHED',
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
          select: {
            id: true,
            title: true,
            description: true,
            heroArtworkUrl: true,
            startsAt: true,
            endsAt: true,
            rewardXp: true,
            locations: {
              where: { isEnabled: true },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                claims: {
                  where: { userId },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        }),
        prisma.userXpBalance.findUnique({
          where: { userId },
          select: { total: true },
        }),
      ]);

      if (!hunt) {
        return { hunt: null, globalXpTotal: xpBalance?.total ?? 0 };
      }

      const { locations, ...summary } = hunt;
      const claimedLocationIds = locations
        .filter((location: any) => location.claims.length > 0)
        .map((location: any) => location.id);

      return {
        hunt: {
          ...summary,
          locationCount: locations.length,
          claimedLocationIds,
          entryCount: claimedLocationIds.length,
        },
        globalXpTotal: xpBalance?.total ?? 0,
      };
    },

    async createClaimWithXp(input: CreateTreasureHuntClaimInput) {
      let awardedXp = 0;
      try {
        await prisma.$transaction(async (tx: any) => {
          if (!(await lockTreasureHunt(tx, input.huntId))) {
            throw new TreasureHuntError(404, 'INVALID_TOKEN', 'This QR code is not valid.');
          }
          if (!(await lockTreasureHuntLocation(tx, input.huntId, input.locationId))) {
            throw new TreasureHuntError(404, 'INVALID_TOKEN', 'This QR code is not valid.');
          }

          const existing = await tx.treasureHuntClaim.findUnique({
            where: {
              userId_locationId: {
                userId: input.userId,
                locationId: input.locationId,
              },
            },
            select: { id: true },
          });
          if (existing) throw new TreasureHuntDuplicateClaimError();

          const location = await tx.treasureHuntLocation.findUnique({
            where: { id: input.locationId },
            select: {
              id: true,
              isEnabled: true,
              hunt: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  startsAt: true,
                  endsAt: true,
                  rewardXp: true,
                },
              },
            },
          });
          if (!location) {
            throw new TreasureHuntError(404, 'INVALID_TOKEN', 'This QR code is not valid.');
          }
          const claimedAt = now();
          assertTreasureHuntLocationClaimable(location, claimedAt);
          awardedXp = location.hunt.rewardXp;

          await tx.treasureHuntClaim.create({
            data: {
              id: input.claimId,
              userId: input.userId,
              locationId: input.locationId,
              source: input.source,
              claimedAt,
              ...(input.capture
                ? {
                    capture: {
                      create: {
                        objectPath: input.capture.objectPath,
                        contentType: input.capture.contentType,
                        byteSize: input.capture.byteSize,
                        sha256: input.capture.sha256,
                        width: input.capture.width,
                        height: input.capture.height,
                      },
                    },
                  }
                : {}),
            },
          });

          // Award through the shared engine so hunt XP counts toward rank and
          // the monthly leaderboard like every other source. Passing `tx` keeps
          // it in this transaction: a failed award rolls the claim back rather
          // than burning the QR token for nothing.
          const award = await awardXp({
            userId: input.userId,
            actionCode: 'hunt_location_claim',
            sourceId: input.claimId,
            xp: awardedXp,
            metadata: { huntLocationId: input.locationId },
            tx,
          });

          // Publishing requires rewardXp > 0, so this is unreachable — but a
          // claim that silently awards nothing burns the QR token for good,
          // so fail loudly rather than trust a check in another file.
          if (!award.awarded) {
            throw new Error(`Treasure hunt claim ${input.claimId} awarded no XP (${award.reason}).`);
          }
        });
      } catch (error: any) {
        const target = error?.meta?.target;
        const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
        if (error?.code === 'P2002' && targetText.includes('userId') && targetText.includes('locationId')) {
          throw new TreasureHuntDuplicateClaimError();
        }
        throw error;
      }

      const claim = await findClaimSummary(prisma, input.userId, input.locationId);
      if (!claim) throw new Error('Created treasure hunt claim could not be loaded.');
      return { claim, awardedXp };
    },

    async findClaim(userId: string, locationId: string) {
      return findClaimSummary(prisma, userId, locationId);
    },

    async resolveLocation(scanValue: string) {
      let url: URL;
      try {
        url = new URL(scanValue);
      } catch {
        return null;
      }

      const hostname = url.hostname.toLowerCase();
      if (hostname === canonicalHost.toLowerCase()) {
        const match = url.pathname.match(/^\/hunt\/([^/]+)\/?$/);
        if (!match) return null;

        const token = decodeURIComponent(match[1]);
        if (!token || token.length > 512) return null;

        return prisma.treasureHuntLocation.findUnique({
          where: { publicTokenHash: hashToken(token) },
          select: locationSelect,
        });
      }

      if (!bitlyHosts.some((host) => host.toLowerCase() === hostname)) {
        return null;
      }

      const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
      const bitlinkUrl = `https://${hostname}${pathname}`;
      const publication = await prisma.treasureHuntBitlyPublication.findFirst({
        where: { bitlinkUrl },
        select: { location: { select: locationSelect } },
      });

      return publication?.location ?? null;
    },
  };

  return repository;
};
