import { randomUUID } from 'crypto';

import { BitlyClient, BitlyError, type BitlyQrImage } from './bitlyService';
import { lockTreasureHunt, lockTreasureHuntLocation } from './treasureHuntDb';

export class AdminValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'AdminValidationError';
  }
}

interface GeneratedToken {
  value: string;
  hash: string;
}

// "Find Cipta" is a one-time event: exactly one TreasureHunt row ever exists.
// The row is created on the first superadmin visit rather than seeded, so every
// environment (local, staging, production) converges on the same state without a
// manual step. These are the values it starts life with.
export const FIND_CIPTA_DEFAULTS = {
  title: 'Find Cipta',
  description: 'Cipta is hiding around the city. Scan the QR at each spot to collect it and earn XP.',
  rewardXp: 50,
  windowDays: 30,
};

export const FIND_CIPTA_EVENT_KEY = 'FIND_CIPTA';

// Find Cipta runs in one physical city, so "per day" means a Malaysian day —
// bucketing on UTC would split an evening's scans across two bars.
const HUNT_TIME_ZONE = 'Asia/Kuala_Lumpur';

const MAX_TITLE_LENGTH = 255;
const QR_PUBLICATION_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_QR_RETRY_SECONDS = 60;

const CLAIM_SOURCES = new Set(['IN_APP_CAMERA', 'EXTERNAL_LINK']);

const assertText = (value: unknown, code: string, message: string, maxLength?: number) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminValidationError(code, message);
  }
  if (maxLength && value.trim().length > maxLength) {
    throw new AdminValidationError(code, `${message} (max ${maxLength} characters)`);
  }
};

const assertDate = (value: unknown, code: string, message: string): Date => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AdminValidationError(code, message);
  }
  return value;
};

// Mirrors the DB CHECK constraints (valid_dates, positive_reward) so an admin
// gets a 400 with a readable message instead of a Postgres error surfacing as a
// generic 500.
const assertHuntFields = (input: {
  title: unknown;
  description: unknown;
  startsAt: unknown;
  endsAt: unknown;
  rewardXp: unknown;
}) => {
  assertText(input.title, 'INVALID_TITLE', 'Event title is required.', MAX_TITLE_LENGTH);
  assertText(input.description, 'INVALID_DESCRIPTION', 'Event description is required.');
  const startsAt = assertDate(input.startsAt, 'INVALID_START_DATE', 'Start date is not a valid date.');
  const endsAt = assertDate(input.endsAt, 'INVALID_END_DATE', 'End date is not a valid date.');
  if (endsAt <= startsAt) {
    throw new AdminValidationError('INVALID_DATE_RANGE', 'The end date must be after the start date.');
  }
  if (!Number.isInteger(input.rewardXp) || (input.rewardXp as number) <= 0) {
    throw new AdminValidationError('INVALID_REWARD_XP', 'XP per scan must be a whole number greater than zero.');
  }
};

const assertLocationFields = (input: { name?: unknown; hint?: unknown; artworkUrl?: unknown }) => {
  if (input.name !== undefined) {
    assertText(input.name, 'INVALID_LOCATION_NAME', 'Location name is required.', MAX_TITLE_LENGTH);
  }
  if (input.hint !== undefined) {
    assertText(input.hint, 'INVALID_LOCATION_HINT', 'Location hint is required.');
  }
  if (input.artworkUrl !== undefined) {
    assertText(input.artworkUrl, 'INVALID_LOCATION_ARTWORK', 'Location artwork is required.');
  }
};

export type TreasureHuntPhase = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';

export const getTreasureHuntPhase = (hunt: any, at: Date): TreasureHuntPhase => {
  if (hunt.status === 'ARCHIVED') return 'archived';
  if (hunt.status === 'DRAFT') return 'draft';
  if (at >= hunt.endsAt) return 'ended';
  if (hunt.status === 'PAUSED') return 'paused';
  if (at < hunt.startsAt) return 'scheduled';
  return 'live';
};

const assertPublishReady = (hunt: any, at: Date) => {
  const enabled = hunt.locations.filter((location: any) => location.isEnabled);
  const preconditionsMet =
    Boolean(hunt.heroArtworkUrl) &&
    hunt.rewardXp > 0 &&
    hunt.endsAt > hunt.startsAt &&
    hunt.endsAt > at &&
    enabled.length > 0 &&
    enabled.every((location: any) => location.artworkUrl && location.bitlyPublication?.status === 'READY');

  if (!preconditionsMet) {
    throw new AdminValidationError(
      'PUBLISH_PRECONDITIONS',
      'Every enabled location needs artwork and a READY QR, plus valid dates, reward, and hero artwork.',
    );
  }
};

interface AdminServiceDeps {
  prisma: any;
  bitly: BitlyClient;
  tokenCipher: { encrypt(plaintext: string): string; decrypt(ciphertext: string): string };
  uploadQrImage: (image: BitlyQrImage, locationId: string) => Promise<string>;
  linkBaseUrl: string;
  generateToken: () => GeneratedToken;
  now?: () => Date;
  createId?: () => string;
}

export const createTreasureHuntAdminService = ({
  prisma,
  bitly,
  tokenCipher,
  uploadQrImage,
  linkBaseUrl,
  generateToken,
  now = () => new Date(),
  createId = randomUUID,
}: AdminServiceDeps) => {
  const audit = (
    db: any,
    actorUserId: string,
    action: string,
    fields: { huntId?: string; locationId?: string; metadata?: Record<string, unknown> },
  ) =>
    db.treasureHuntAuditLog.create({
      data: {
        actorUserId,
        huntId: fields.huntId ?? null,
        locationId: fields.locationId ?? null,
        action,
        metadata: fields.metadata ?? undefined,
      },
    });

  const isUniqueConstraintError = (error: any, field: string) => {
    const target = error?.meta?.target;
    const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return error?.code === 'P2002' && targetText.includes(field);
  };

  const assertHuntLock = async (tx: any, huntId: string) => {
    if (!(await lockTreasureHunt(tx, huntId))) {
      throw new AdminValidationError('HUNT_NOT_FOUND', 'Treasure hunt not found.', 404);
    }
  };

  const assertLocationLock = async (tx: any, huntId: string, locationId: string) => {
    if (!(await lockTreasureHuntLocation(tx, huntId, locationId))) {
      throw new AdminValidationError('LOCATION_NOT_FOUND', 'Location not found in this event.', 404);
    }
  };

  // Collections per calendar day, for the overview chart. Bucketed in the event's
  // own timezone rather than UTC, so a scan at 1am local lands on the day the
  // admin would call it — claimedAt is a naive TIMESTAMP holding UTC, hence the
  // double AT TIME ZONE. Only days that saw a scan come back; the client fills
  // the gaps, so an empty event costs one row instead of a month of zeroes.
  const getDailyClaims = async (huntId: string) => {
    const rows = (await prisma.$queryRaw`
      SELECT to_char(
               (c."claimedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${HUNT_TIME_ZONE}::text)::date,
               'YYYY-MM-DD'
             ) AS "date",
             COUNT(*)::bigint AS "claims"
      FROM "TreasureHuntClaim" c
      INNER JOIN "TreasureHuntLocation" l ON l."id" = c."locationId"
      WHERE l."huntId" = ${huntId}
      GROUP BY 1
      ORDER BY 1 ASC
    `) as { date: string; claims: bigint }[];

    return rows.map((row) => ({ date: row.date, claims: Number(row.claims) }));
  };

  // Declared outside the service object so the methods below can reuse them
  // without a self-referential `service.x` call (which TypeScript cannot infer).
  const getHuntDetail = async ({ huntId }: { huntId: string }) => {
    const [hunt, dailyClaims] = await Promise.all([
      prisma.treasureHunt.findUnique({
        where: { id: huntId },
        include: {
          locations: {
            orderBy: { sortOrder: 'asc' },
            include: {
              bitlyPublication: true,
              _count: { select: { claims: true } },
              // Newest claim only — the admin table shows when a spot was last
              // found, which is how you tell a dead location from a slow one.
              claims: { orderBy: { claimedAt: 'desc' }, take: 1, select: { claimedAt: true } },
            },
          },
        },
      }),
      getDailyClaims(huntId),
    ]);

    return hunt ? { ...hunt, dailyClaims } : hunt;
  };

  const createHunt = async (input: {
    actorUserId: string;
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    rewardXp?: number;
    heroArtworkUrl?: string | null;
  }) => {
    assertHuntFields({
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      rewardXp: input.rewardXp ?? FIND_CIPTA_DEFAULTS.rewardXp,
    });

    try {
      return await prisma.$transaction(async (tx: any) => {
        const hunt = await tx.treasureHunt.create({
          data: {
            eventKey: FIND_CIPTA_EVENT_KEY,
            title: input.title,
            description: input.description,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            rewardXp: input.rewardXp ?? FIND_CIPTA_DEFAULTS.rewardXp,
            heroArtworkUrl: input.heroArtworkUrl ?? null,
            status: 'DRAFT',
            createdById: input.actorUserId,
          },
        });
        await audit(tx, input.actorUserId, 'HUNT_CREATED', { huntId: hunt.id });
        return hunt;
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'eventKey')) {
        throw new AdminValidationError(
          'HUNT_ALREADY_EXISTS',
          'Find Cipta is a one-time event and already exists.',
          409,
        );
      }
      throw error;
    }
  };

  const service = {
    createHunt,
    getHuntDetail,

    // Resolves the single Find Cipta event, creating it on first use. Returns the
    // same shape as getHuntDetail so the admin UI only ever deals with one payload.
    async getCurrentHunt({ actorUserId }: { actorUserId: string }) {
      const existing = await prisma.treasureHunt.findUnique({
        where: { eventKey: FIND_CIPTA_EVENT_KEY },
        select: { id: true },
      });

      if (existing) {
        return getHuntDetail({ huntId: existing.id });
      }

      const startsAt = now();
      const endsAt = new Date(startsAt.getTime() + FIND_CIPTA_DEFAULTS.windowDays * 24 * 60 * 60 * 1000);
      try {
        const created = await createHunt({
          actorUserId,
          title: FIND_CIPTA_DEFAULTS.title,
          description: FIND_CIPTA_DEFAULTS.description,
          startsAt,
          endsAt,
          rewardXp: FIND_CIPTA_DEFAULTS.rewardXp,
        });
        return getHuntDetail({ huntId: created.id });
      } catch (error) {
        if (!(error instanceof AdminValidationError) || error.code !== 'HUNT_ALREADY_EXISTS') throw error;
        const winner = await prisma.treasureHunt.findUnique({
          where: { eventKey: FIND_CIPTA_EVENT_KEY },
          select: { id: true },
        });
        if (!winner) throw error;
        return getHuntDetail({ huntId: winner.id });
      }
    },

    async updateHunt(input: {
      actorUserId: string;
      huntId: string;
      title?: string;
      description?: string;
      startsAt?: Date;
      endsAt?: Date;
      rewardXp?: number;
      heroArtworkUrl?: string;
    }) {
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const hunt = await tx.treasureHunt.findUnique({ where: { id: input.huntId } });
        const changedAt = now();
        const phase = getTreasureHuntPhase(hunt, changedAt);
        if (phase === 'archived' || phase === 'ended') {
          throw new AdminValidationError('HUNT_ENDED', 'This event has ended and can no longer be edited.', 409);
        }

        const startsAt = input.startsAt ?? hunt.startsAt;
        const endsAt = input.endsAt ?? hunt.endsAt;
        assertHuntFields({
          title: input.title ?? hunt.title,
          description: input.description ?? hunt.description,
          startsAt,
          endsAt,
          rewardXp: input.rewardXp ?? hunt.rewardXp,
        });

        if (
          (phase === 'live' || phase === 'paused') &&
          input.startsAt !== undefined &&
          input.startsAt.getTime() !== hunt.startsAt.getTime()
        ) {
          throw new AdminValidationError(
            'START_DATE_LOCKED',
            'The start date cannot be changed after the event begins.',
            409,
          );
        }
        if (hunt.status !== 'DRAFT' && endsAt <= changedAt) {
          throw new AdminValidationError('INVALID_END_DATE', 'An active event must end in the future.', 409);
        }

        const data: Record<string, unknown> = {};
        if (input.title !== undefined) data.title = input.title.trim();
        if (input.description !== undefined) data.description = input.description.trim();
        if (input.startsAt !== undefined) data.startsAt = input.startsAt;
        if (input.endsAt !== undefined) data.endsAt = input.endsAt;
        if (input.rewardXp !== undefined) data.rewardXp = input.rewardXp;
        if (input.heroArtworkUrl !== undefined) data.heroArtworkUrl = input.heroArtworkUrl;

        if (Object.keys(data).length === 0) return hunt;

        const updated = await tx.treasureHunt.update({
          where: { id: input.huntId },
          data: { ...data, updatedById: input.actorUserId },
        });
        await audit(tx, input.actorUserId, 'HUNT_UPDATED', {
          huntId: input.huntId,
          metadata: { fields: Object.keys(data) },
        });
        return updated;
      });
    },

    async addLocation(input: { actorUserId: string; huntId: string; name: string; hint: string; artworkUrl: string }) {
      assertLocationFields(input);
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const max = await tx.treasureHuntLocation.aggregate({
          where: { huntId: input.huntId },
          _max: { sortOrder: true },
        });
        const sortOrder = (max._max.sortOrder ?? -1) + 1;
        const location = await tx.treasureHuntLocation.create({
          data: {
            huntId: input.huntId,
            name: input.name.trim(),
            hint: input.hint.trim(),
            artworkUrl: input.artworkUrl,
            sortOrder,
          },
        });
        await audit(tx, input.actorUserId, 'LOCATION_ADDED', {
          huntId: input.huntId,
          locationId: location.id,
        });
        return location;
      });
    },

    async updateLocation(input: {
      actorUserId: string;
      huntId: string;
      locationId: string;
      name?: string;
      hint?: string;
      isEnabled?: boolean;
      artworkUrl?: string;
    }) {
      assertLocationFields(input);
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        await assertLocationLock(tx, input.huntId, input.locationId);
        const [hunt, location] = await Promise.all([
          tx.treasureHunt.findUnique({ where: { id: input.huntId } }),
          tx.treasureHuntLocation.findUnique({ where: { id: input.locationId } }),
        ]);

        if (getTreasureHuntPhase(hunt, now()) === 'live' && location.isEnabled && input.isEnabled === false) {
          const enabledCount = await tx.treasureHuntLocation.count({
            where: { huntId: input.huntId, isEnabled: true },
          });
          if (enabledCount <= 1) {
            throw new AdminValidationError(
              'LAST_LIVE_LOCATION',
              'Pause the event before disabling its final active location.',
              409,
            );
          }
        }

        const data: Record<string, unknown> = {};
        if (input.name !== undefined) data.name = input.name.trim();
        if (input.hint !== undefined) data.hint = input.hint.trim();
        if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
        if (input.artworkUrl !== undefined) data.artworkUrl = input.artworkUrl;

        if (Object.keys(data).length === 0) return location;

        const updated = await tx.treasureHuntLocation.update({
          where: { id: input.locationId },
          data,
        });
        await audit(tx, input.actorUserId, 'LOCATION_UPDATED', {
          huntId: input.huntId,
          locationId: input.locationId,
          metadata: { fields: Object.keys(data) },
        });
        return updated;
      });
    },

    // Deleting is only allowed while nobody has collected the spot — claims carry
    // immutable XP, so removing one would orphan a ledger entry. Note the remote
    // Bitly bitlink/QR is not deleted (Bitly has no delete in bitlyService); the
    // local record and its token go away, which makes the printed QR inert.
    async deleteLocation(input: { actorUserId: string; huntId: string; locationId: string }) {
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        await assertLocationLock(tx, input.huntId, input.locationId);
        const [hunt, location] = await Promise.all([
          tx.treasureHunt.findUnique({ where: { id: input.huntId } }),
          tx.treasureHuntLocation.findUnique({
            where: { id: input.locationId },
            include: { bitlyPublication: true, _count: { select: { claims: true } } },
          }),
        ]);
        if (location._count.claims > 0) {
          throw new AdminValidationError(
            'LOCATION_HAS_CLAIMS',
            `${location._count.claims} participant(s) have already collected this spot. Disable it instead of deleting it.`,
            409,
          );
        }
        if (location.bitlyPublication?.leaseExpiresAt && location.bitlyPublication.leaseExpiresAt > now()) {
          throw new AdminValidationError(
            'QR_PUBLISH_IN_PROGRESS',
            'Wait for QR generation to finish before deleting this location.',
            409,
          );
        }
        if (getTreasureHuntPhase(hunt, now()) === 'live' && location.isEnabled) {
          const enabledCount = await tx.treasureHuntLocation.count({
            where: { huntId: input.huntId, isEnabled: true },
          });
          if (enabledCount <= 1) {
            throw new AdminValidationError(
              'LAST_LIVE_LOCATION',
              'Pause the event before deleting its final active location.',
              409,
            );
          }
        }

        await tx.treasureHuntLocation.delete({ where: { id: input.locationId } });
        await audit(tx, input.actorUserId, 'LOCATION_DELETED', {
          huntId: input.huntId,
          metadata: { locationId: input.locationId, name: location.name },
        });
        return { id: input.locationId };
      });
    },

    async reorderLocations(input: { actorUserId: string; huntId: string; orderedIds: string[] }) {
      await prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const locations = await tx.treasureHuntLocation.findMany({
          where: { huntId: input.huntId },
          select: { id: true },
        });
        const currentIds = locations.map((location: any) => location.id);
        const ordered = input.orderedIds ?? [];
        const isSameSet =
          Array.isArray(ordered) &&
          ordered.length === currentIds.length &&
          new Set(ordered).size === ordered.length &&
          currentIds.every((id: string) => ordered.includes(id));

        if (!isSameSet) {
          throw new AdminValidationError(
            'INVALID_LOCATION_ORDER',
            'The new order must list every location in this event exactly once.',
          );
        }

        for (const [index, id] of ordered.entries()) {
          await tx.treasureHuntLocation.update({ where: { id }, data: { sortOrder: -1 - index } });
        }
        for (const [index, id] of ordered.entries()) {
          await tx.treasureHuntLocation.update({ where: { id }, data: { sortOrder: index } });
        }

        await audit(tx, input.actorUserId, 'LOCATIONS_REORDERED', {
          huntId: input.huntId,
          metadata: { orderedIds: ordered },
        });
      });
      return getHuntDetail({ huntId: input.huntId });
    },

    async publishHunt(input: { actorUserId: string; huntId: string; feature?: boolean }) {
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const hunt = await tx.treasureHunt.findUnique({
          where: { id: input.huntId },
          include: { locations: { include: { bitlyPublication: true } } },
        });
        const publishedAt = now();
        if (getTreasureHuntPhase(hunt, publishedAt) !== 'draft') {
          throw new AdminValidationError('INVALID_HUNT_TRANSITION', 'Only a draft event can be published.', 409);
        }
        assertPublishReady(hunt, publishedAt);

        const feature = input.feature !== false;
        if (feature) {
          await tx.treasureHunt.updateMany({
            where: { featuredSlot: 1 },
            data: { featuredSlot: null },
          });
        }

        const updated = await tx.treasureHunt.update({
          where: { id: input.huntId },
          data: {
            status: 'PUBLISHED',
            publishedAt,
            pausedAt: null,
            archivedAt: null,
            ...(feature ? { featuredSlot: 1 } : {}),
            updatedById: input.actorUserId,
          },
        });
        await audit(tx, input.actorUserId, 'HUNT_PUBLISHED', {
          huntId: input.huntId,
          metadata: { feature },
        });
        return updated;
      });
    },

    async pauseHunt(input: { actorUserId: string; huntId: string }) {
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const hunt = await tx.treasureHunt.findUnique({ where: { id: input.huntId } });
        const pausedAt = now();
        if (getTreasureHuntPhase(hunt, pausedAt) !== 'live') {
          throw new AdminValidationError('INVALID_HUNT_TRANSITION', 'Only a live event can be paused.', 409);
        }
        const updated = await tx.treasureHunt.update({
          where: { id: input.huntId },
          data: { status: 'PAUSED', pausedAt, updatedById: input.actorUserId },
        });
        await audit(tx, input.actorUserId, 'HUNT_PAUSED', { huntId: input.huntId });
        return updated;
      });
    },

    async resumeHunt(input: { actorUserId: string; huntId: string }) {
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const hunt = await tx.treasureHunt.findUnique({
          where: { id: input.huntId },
          include: { locations: { include: { bitlyPublication: true } } },
        });
        const resumedAt = now();
        if (getTreasureHuntPhase(hunt, resumedAt) !== 'paused') {
          throw new AdminValidationError(
            'INVALID_HUNT_TRANSITION',
            'Only a paused, unexpired event can be resumed.',
            409,
          );
        }
        assertPublishReady(hunt, resumedAt);
        const updated = await tx.treasureHunt.update({
          where: { id: input.huntId },
          data: { status: 'PUBLISHED', pausedAt: null, updatedById: input.actorUserId },
        });
        await audit(tx, input.actorUserId, 'HUNT_RESUMED', { huntId: input.huntId });
        return updated;
      });
    },

    async reactivateHunt(input: { actorUserId: string; huntId: string }) {
      return prisma.$transaction(
        async (tx: any) => {
          await assertHuntLock(tx, input.huntId);
          const reactivatedAt = now();
          const endsAt = new Date(reactivatedAt.getTime() + FIND_CIPTA_DEFAULTS.windowDays * 24 * 60 * 60 * 1000);
          const hunt = await tx.treasureHunt.findUnique({
            where: { id: input.huntId },
            include: { locations: { include: { bitlyPublication: true } } },
          });
          if (!hunt) {
            throw new AdminValidationError('HUNT_NOT_FOUND', 'Treasure hunt not found.');
          }

          const phase = getTreasureHuntPhase(hunt, reactivatedAt);
          if (phase !== 'archived' && phase !== 'ended') {
            throw new AdminValidationError('HUNT_NOT_ENDED', 'Only an ended event can be re-enabled.', 409);
          }

          assertPublishReady({ ...hunt, startsAt: reactivatedAt, endsAt }, reactivatedAt);

          await tx.treasureHunt.updateMany({
            where: { featuredSlot: 1, NOT: { id: input.huntId } },
            data: { featuredSlot: null },
          });

          const transition = await tx.treasureHunt.updateMany({
            where: { id: input.huntId },
            data: {
              status: 'PUBLISHED',
              startsAt: reactivatedAt,
              endsAt,
              publishedAt: reactivatedAt,
              featuredSlot: 1,
              archivedAt: null,
              pausedAt: null,
              updatedById: input.actorUserId,
            },
          });
          if (transition.count !== 1) {
            throw new AdminValidationError('HUNT_NOT_ENDED', 'Only an ended event can be re-enabled.', 409);
          }

          await tx.treasureHuntAuditLog.create({
            data: {
              actorUserId: input.actorUserId,
              huntId: input.huntId,
              action: 'HUNT_REACTIVATED',
              metadata: {
                fromStatus: hunt.status,
                oldStartsAt: hunt.startsAt.toISOString(),
                oldEndsAt: hunt.endsAt.toISOString(),
                newStartsAt: reactivatedAt.toISOString(),
                newEndsAt: endsAt.toISOString(),
                featuredSlot: 1,
              },
            },
          });

          return tx.treasureHunt.findUnique({ where: { id: input.huntId } });
        },
        { isolationLevel: 'Serializable' },
      );
    },

    async archiveHunt(input: { actorUserId: string; huntId: string }) {
      return prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, input.huntId);
        const hunt = await tx.treasureHunt.findUnique({ where: { id: input.huntId } });
        const archivedAt = now();
        const phase = getTreasureHuntPhase(hunt, archivedAt);
        if (phase === 'archived' || phase === 'ended') {
          throw new AdminValidationError(
            'INVALID_HUNT_TRANSITION',
            'This event has already ended. Re-enable it instead.',
            409,
          );
        }
        const updated = await tx.treasureHunt.update({
          where: { id: input.huntId },
          data: {
            status: 'ARCHIVED',
            archivedAt,
            featuredSlot: null,
            updatedById: input.actorUserId,
          },
        });
        await audit(tx, input.actorUserId, 'HUNT_ARCHIVED', { huntId: input.huntId });
        return updated;
      });
    },

    async listHunts() {
      return prisma.treasureHunt.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { locations: true } } },
      });
    },

    async getDashboard({ huntId }: { huntId: string }) {
      const hunt = await prisma.treasureHunt.findUnique({
        where: { id: huntId },
        include: {
          locations: {
            orderBy: { sortOrder: 'asc' },
            include: {
              bitlyPublication: true,
              _count: { select: { claims: true } },
              claims: {
                orderBy: { claimedAt: 'desc' },
                take: 1,
                select: { claimedAt: true },
              },
            },
          },
        },
      });
      if (!hunt) {
        throw new AdminValidationError('HUNT_NOT_FOUND', 'Treasure hunt not found.');
      }

      const [claims, participantRows, xpRows] = await Promise.all([
        prisma.treasureHuntClaim.count({ where: { location: { huntId } } }),
        prisma.treasureHuntClaim.groupBy({
          by: ['userId'],
          where: { location: { huntId } },
        }),
        prisma.$queryRaw`
          SELECT COALESCE(SUM(x."amount"), 0)::bigint AS "total"
          FROM "XpTransaction" x
          INNER JOIN "TreasureHuntClaim" c ON c."id" = x."sourceId"
          INNER JOIN "TreasureHuntLocation" l ON l."id" = c."locationId"
          WHERE x."sourceType" = 'HUNT_LOCATION_CLAIM'::"XpSourceType"
            AND l."huntId" = ${huntId}
        ` as Promise<{ total: bigint }[]>,
      ]);
      const uniqueParticipants = participantRows.length;
      const xpAwarded = Number(xpRows[0]?.total ?? 0);

      const locations = hunt.locations.map((location: any) => {
        const rawScanCount = location.bitlyPublication?.rawScanCount ?? 0;
        const claimCount = location._count.claims;
        return {
          id: location.id,
          name: location.name,
          isEnabled: location.isEnabled,
          status: location.bitlyPublication?.status ?? 'NOT_STARTED',
          rawScanCount,
          claimCount,
          conversion: rawScanCount > 0 ? claimCount / rawScanCount : 0,
          analyticsSyncedAt: location.bitlyPublication?.lastAnalyticsSyncedAt ?? null,
          lastCollectedAt: location.claims[0]?.claimedAt ?? null,
        };
      });

      return {
        totals: {
          rawScans: locations.reduce((sum: number, l: any) => sum + l.rawScanCount, 0),
          claims,
          uniqueParticipants,
          xpAwarded,
        },
        locations,
      };
    },

    async listParticipants({
      huntId,
      skip = 0,
      take = 25,
      search,
      locationId,
      source,
      sortBy,
      sortOrder,
    }: {
      huntId: string;
      skip?: number;
      take?: number;
      search?: string;
      locationId?: string;
      source?: string;
      sortBy?: string;
      sortOrder?: string;
    }) {
      const safeTake = Math.min(Math.max(Number.isFinite(take) ? Math.trunc(take) : 25, 1), 100);
      const safeSkip = Math.max(Number.isFinite(skip) ? Math.trunc(skip) : 0, 0);
      const term = search?.trim();
      const selectedLocationId = locationId?.trim();
      const selectedSource = CLAIM_SOURCES.has(source as string) ? source : undefined;

      // Whitelisted so an arbitrary query string can never reach into orderBy.
      const direction = sortOrder === 'asc' ? 'asc' : 'desc';
      const orderBy = sortBy === 'location' ? { location: { name: direction } } : { claimedAt: direction };

      const where = {
        location: { huntId },
        ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
        ...(selectedSource ? { source: selectedSource } : {}),
        ...(term
          ? {
              user: {
                OR: [
                  { name: { contains: term, mode: 'insensitive' } },
                  { email: { contains: term, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      };

      const [rows, total, enabledLocationCount] = await Promise.all([
        prisma.treasureHuntClaim.findMany({
          where,
          orderBy,
          skip: safeSkip,
          take: safeTake,
          include: {
            user: { select: { name: true, email: true, photoURL: true } },
            location: { select: { name: true } },
            // Presence only — the image itself is fetched on demand through the
            // audited signed-URL route, never listed in bulk.
            capture: { select: { id: true } },
          },
        }),
        prisma.treasureHuntClaim.count({ where }),
        prisma.treasureHuntLocation.count({ where: { huntId, isEnabled: true } }),
      ]);

      // Per-creator progress, scoped to the creators on this page so the count
      // stays proportional to the page rather than the whole event. Disabled
      // spots are excluded on both sides of the fraction so "4 of 4" is
      // reachable even after a location is switched off.
      const userIds = [...new Set(rows.map((row: any) => row.userId))];
      const progressRows = userIds.length
        ? await prisma.treasureHuntClaim.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds }, location: { huntId, isEnabled: true } },
            _count: { _all: true },
          })
        : [];
      const collectedByUser = new Map<string, number>(progressRows.map((row: any) => [row.userId, row._count._all]));

      return {
        rows: rows.map((row: any) => ({
          ...row,
          hasCapture: Boolean(row.capture),
          collectedCount: collectedByUser.get(row.userId) ?? 0,
        })),
        total,
        enabledLocationCount,
      };
    },

    async getParticipantsForCsv({ huntId }: { huntId: string }) {
      const claims = await prisma.treasureHuntClaim.findMany({
        where: { location: { huntId } },
        orderBy: { claimedAt: 'desc' },
        include: {
          user: { select: { name: true, email: true } },
          location: { select: { name: true } },
        },
      });
      return claims.map((claim: any) => ({
        name: claim.user?.name ?? null,
        email: claim.user?.email ?? null,
        locationName: claim.location.name,
        source: claim.source,
        claimedAt: claim.claimedAt,
      }));
    },

    async syncLocationAnalytics({ locationId }: { locationId: string }) {
      const publication = await prisma.treasureHuntBitlyPublication.findUnique({
        where: { locationId },
      });
      if (!publication?.qrCodeId) return;

      const rawScanCount = await bitly.getQrScanCount({ qrCodeId: publication.qrCodeId });
      await prisma.treasureHuntBitlyPublication.update({
        where: { locationId },
        data: {
          rawScanCount,
          analyticsSource: 'qr_scans',
          lastAnalyticsSyncedAt: now(),
        },
      });
    },

    // The lease serializes slow Bitly/GCS work without holding a database
    // transaction open across network calls. Every checkpoint verifies lease
    // ownership so an expired worker cannot overwrite a newer attempt.
    async publishLocationQr({
      actorUserId,
      huntId,
      locationId,
    }: {
      actorUserId: string;
      huntId: string;
      locationId: string;
    }) {
      const leaseId = createId();
      const acquired = await prisma.$transaction(async (tx: any) => {
        await assertHuntLock(tx, huntId);
        await assertLocationLock(tx, huntId, locationId);
        const acquiredAt = now();
        const location = await tx.treasureHuntLocation.findUnique({
          where: { id: locationId },
          include: { bitlyPublication: true },
        });
        let publication =
          location.bitlyPublication ??
          (await tx.treasureHuntBitlyPublication.create({
            data: { locationId, status: 'NOT_STARTED' },
          }));

        if (publication.leaseId && publication.leaseExpiresAt && publication.leaseExpiresAt > acquiredAt) {
          throw new AdminValidationError(
            'QR_PUBLISH_IN_PROGRESS',
            'Another QR generation is already running for this location.',
            409,
          );
        }
        if (publication.nextRetryAt && publication.nextRetryAt > acquiredAt) {
          throw new AdminValidationError(
            'QR_PUBLISH_RATE_LIMITED',
            `QR generation can be retried after ${publication.nextRetryAt.toISOString()}.`,
            429,
          );
        }

        let tokenValue: string | undefined;
        if (!location.publicTokenHash) {
          const token = generateToken();
          tokenValue = token.value;
          await tx.treasureHuntLocation.update({
            where: { id: locationId },
            data: {
              publicTokenHash: token.hash,
              publicTokenCiphertext: tokenCipher.encrypt(token.value),
              tokenIssuedAt: acquiredAt,
              tokenVersion: { increment: 1 },
            },
          });
        } else if (!publication.bitlinkId) {
          tokenValue = location.publicTokenCiphertext ? tokenCipher.decrypt(location.publicTokenCiphertext) : undefined;
        }

        const leaseExpiresAt = new Date(acquiredAt.getTime() + QR_PUBLICATION_LEASE_MS);
        publication = await tx.treasureHuntBitlyPublication.update({
          where: { locationId },
          data: { leaseId, leaseExpiresAt, lastAttemptAt: acquiredAt },
        });

        return { locationName: location.name, publication, tokenValue };
      });

      let publication = acquired.publication;
      const setPublication = async (data: Record<string, unknown>) => {
        const checkpointAt = now();
        const result = await prisma.treasureHuntBitlyPublication.updateMany({
          where: { locationId, leaseId },
          data: {
            ...data,
            lastAttemptAt: checkpointAt,
            leaseExpiresAt: new Date(checkpointAt.getTime() + QR_PUBLICATION_LEASE_MS),
          },
        });
        if (result.count !== 1) {
          throw new AdminValidationError(
            'QR_PUBLISH_LEASE_LOST',
            'This QR generation attempt expired. Refresh before trying again.',
            409,
          );
        }
        publication = { ...publication, ...data };
      };

      const finish = async (
        data: Record<string, unknown>,
        action: 'QR_PUBLISHED' | 'QR_PUBLISH_FAILED',
        metadata: Record<string, unknown>,
      ) =>
        prisma.$transaction(async (tx: any) => {
          if (!(await lockTreasureHunt(tx, huntId))) return false;
          if (!(await lockTreasureHuntLocation(tx, huntId, locationId))) return false;
          const result = await tx.treasureHuntBitlyPublication.updateMany({
            where: { locationId, leaseId },
            data: { ...data, leaseId: null, leaseExpiresAt: null, lastAttemptAt: now() },
          });
          if (result.count !== 1) return false;
          await audit(tx, actorUserId, action, { huntId, locationId, metadata });
          return true;
        });

      const wasReady = publication.status === 'READY';
      try {
        if (!publication.bitlinkId) {
          if (!acquired.tokenValue) {
            throw new BitlyError('UNAVAILABLE', false, 'Token unavailable for bitlink creation.');
          }
          const longUrl = `${linkBaseUrl.replace(/\/$/, '')}/hunt/${acquired.tokenValue}`;
          const { bitlinkId, bitlinkUrl } = await bitly.createBitlink({
            longUrl,
            title: `Cipta — ${acquired.locationName}`,
          });
          await setPublication({
            status: 'BITLINK_CREATED',
            bitlinkId,
            bitlinkUrl,
            lastErrorCode: null,
            lastErrorMessage: null,
          });
        }

        if (!publication.qrCodeId) {
          const { qrCodeId } = await bitly.createQrCode({
            bitlinkId: publication.bitlinkId,
            title: `Cipta — ${acquired.locationName}`,
          });
          await setPublication({ status: 'QR_CREATED', qrCodeId });
        }

        const image = await bitly.downloadQrImage({ qrCodeId: publication.qrCodeId });
        const qrImageUrl = await uploadQrImage(image, locationId);
        const finished = await finish(
          {
            status: 'READY',
            qrImageUrl,
            nextRetryAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
          'QR_PUBLISHED',
          { qrCodeId: publication.qrCodeId },
        );
        if (!finished) {
          throw new AdminValidationError(
            'QR_PUBLISH_LEASE_LOST',
            'This QR generation attempt expired. Refresh before trying again.',
            409,
          );
        }
        return { status: 'READY', qrImageUrl };
      } catch (error) {
        const bitlyError = error instanceof BitlyError ? error : null;
        const code = bitlyError?.code ?? 'UNEXPECTED_ERROR';
        const retryAfter = bitlyError?.retryAfterSeconds ?? DEFAULT_QR_RETRY_SECONDS;
        const failedAt = now();
        const nextRetryAt =
          bitlyError?.code === 'RATE_LIMITED' ? new Date(failedAt.getTime() + retryAfter * 1000) : null;
        await finish(
          {
            status: wasReady ? 'READY' : bitlyError?.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED',
            nextRetryAt,
            lastErrorCode: code,
            lastErrorMessage: error instanceof Error ? error.message : 'QR generation failed.',
          },
          'QR_PUBLISH_FAILED',
          { code },
        );
        throw error;
      }
    },
  };

  return service;
};

export type TreasureHuntAdminService = ReturnType<typeof createTreasureHuntAdminService>;
