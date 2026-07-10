import { Prisma } from '@prisma/client';

interface RatingSide {
  adminRating: number | null;
  clientRating: number | null;
}

interface RatingEventInput {
  id: string;
  adminRatedAt: Date | string | null;
  clientRatedAt: Date | string | null;
}

interface CompletedCreatorRatingRow extends RatingEventInput {
  campaignId: string;
  adminRating: number | null;
  clientRating: number | null;
  adminRatingTags: string[];
  adminRatingNote: string | null;
  campaign: {
    name: string;
    campaignBrief?: {
      images?: Prisma.JsonValue | null;
    } | null;
  };
}

export interface CreatorRatingReveal {
  id: string;
  campaignId: string;
  ratingEventId: string;
  campaignName: string;
  campaignImageUrl: string | null;
  adminRating: number;
  clientRating: number;
  finalRating: number;
  adminRatingTags: string[];
  adminRatingNote: string | null;
  completedAt: string;
}

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const hasBothRatings = (value: RatingSide) =>
  typeof value.adminRating === 'number' && typeof value.clientRating === 'number';

const getCampaignImageUrl = (images: Prisma.JsonValue | null | undefined) => {
  if (!Array.isArray(images) || typeof images[0] !== 'string') return null;
  return images[0];
};

export const buildCreatorRatingEventId = (row: RatingEventInput) => {
  const adminRatedAt = toIso(row.adminRatedAt);
  const clientRatedAt = toIso(row.clientRatedAt);
  return `${row.id}:${adminRatedAt ?? 'no-admin-date'}:${clientRatedAt ?? 'no-client-date'}`;
};

export const shouldEmitCreatorRatingCompleted = (before: RatingSide, after: RatingSide) =>
  !hasBothRatings(before) && hasBothRatings(after);

export const mapCompletedCreatorRatingReveal = (row: CompletedCreatorRatingRow): CreatorRatingReveal | null => {
  const { adminRating, clientRating } = row;
  if (typeof adminRating !== 'number' || typeof clientRating !== 'number' || !row.adminRatedAt || !row.clientRatedAt) {
    return null;
  }

  const adminRatedAt = toIso(row.adminRatedAt);
  const clientRatedAt = toIso(row.clientRatedAt);
  if (!adminRatedAt || !clientRatedAt) return null;

  const completedAt =
    new Date(adminRatedAt).getTime() > new Date(clientRatedAt).getTime() ? adminRatedAt : clientRatedAt;
  const finalRating = Math.round(((adminRating + clientRating) / 2) * 10) / 10;

  return {
    id: row.id,
    campaignId: row.campaignId,
    ratingEventId: buildCreatorRatingEventId(row),
    campaignName: row.campaign.name,
    campaignImageUrl: getCampaignImageUrl(row.campaign.campaignBrief?.images),
    adminRating,
    clientRating,
    finalRating,
    adminRatingTags: row.adminRatingTags,
    adminRatingNote: row.adminRatingNote,
    completedAt,
  };
};
