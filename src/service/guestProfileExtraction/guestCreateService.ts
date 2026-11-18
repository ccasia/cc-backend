import crypto from 'crypto';

import type { MetricBaseline, SupportedPlatform } from '@/src/types/guestProfileExtraction';
import { verifyReceipt } from './extractionReceiptService';
import { classifyMetricProvenance } from './metricProvenance';
import { normalizeProfileUrl } from './profileUrlNormalizer';

/**
 * Eligibility, receipt verification, and idempotency for the final create.
 *
 * The order the plan fixes, and the tests hold:
 *  1. Validate and normalize every value.
 *  2. Verify every receipt signature and binding, outside the transaction.
 *  3. Inside one transaction: consume the nonce, resolve or create the guest
 *     and the pitch, write the audit, and save the idempotency response.
 *
 * A receipt is never claimed before that transaction commits.
 */

export const GUEST_CREATE_OPERATION = 'guest_shortlist_create';

/** Matches the existing controller guard and the frontend row machine. */
// Below Postgres INT (2,147,483,647): manualFollowerCount, the shortlist
// follower count, and the audit columns are all INT, and a larger value fails
// the write. Still about 3x the largest account on either platform.
export const MAX_FOLLOWER_COUNT = 2_000_000_000;

export const ALLOWED_FALLBACK_REASONS = ['INSUFFICIENT_DATA', 'PRIVATE_PROFILE', 'PROFILE_NOT_FOUND'] as const;

export interface SubmittedGuest {
  profileLink: string;
  name?: string | null;
  followerCount?: string | number | null;
  engagementRate?: string | number | null;
  adminComments?: string | null;
  /** Read in manual mode only. Automatic mode derives platform from the link. */
  selectedPlatform?: string | null;
  completionReceipt?: string | null;
  extractionId?: string | null;
  fallbackReason?: string | null;
  fallbackConfirmed?: boolean;
}

export type GuestRejectionCode =
  | 'INVALID_PROFILE_LINK'
  | 'NO_RECEIPT'
  | 'RECEIPT_INVALID'
  | 'FALLBACK_NOT_CONFIRMED'
  | 'FALLBACK_NOT_ALLOWED'
  | 'MISSING_NAME'
  | 'INVALID_FOLLOWER_COUNT'
  | 'INVALID_ENGAGEMENT_RATE'
  | 'DUPLICATE_PROFILE'
  | 'EXTRACTION_NOT_FOUND'
  | 'EXTRACTION_NOT_READY'
  | 'EXTRACTION_NOT_ATTACHABLE';

/** Statuses that may be bound to a pitch before metrics exist. */
export const ATTACHABLE_STATUSES = ['QUEUED', 'RUNNING', 'POLLING', 'REQUIRES_RECONCILIATION'] as const;

export type AcceptedExtraction = {
  kind: 'ready' | 'pending';
  id: string;
  nonce: string | null;
  actorId: string | null;
  actorBuild: string | null;
  actorRunId: string | null;
  formulaVersion: string | null;
};

export interface AcceptedGuest {
  /** Null when the link is outside Instagram, TikTok, and Threads. */
  canonicalProfileKey: string | null;
  canonicalProfileUrl: string | null;
  /** The raw link, used when there is no canonical form. */
  rawProfileLink: string;
  platform: SupportedPlatform | null;
  name: string;
  followerCount: number | null;
  /** Engagement rate percent, or Recent Views digits on Threads. */
  engagementRate: string | null;
  adminComments: string | null;
  /** Set for a receipt-backed row or an in-flight attach. */
  extraction: AcceptedExtraction | null;
  baseline: MetricBaseline;
  fallbackReason: string | null;
}

export interface RejectedGuest {
  profileLink: string;
  code: GuestRejectionCode;
  message: string;
}

/* --------------------------------------------------------------- numbers */

export function parseFollowerCount(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_FOLLOWER_COUNT ? value : 'invalid';
  }
  if (typeof value !== 'string') return 'invalid';

  // Thousands separators are stripped, because the pitch modal field is free
  // text. Everything else stays strict.
  const trimmed = value.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  // Digits only. No decimals, no signs, no spaces, no exponent.
  if (!/^\d+$/.test(trimmed)) return 'invalid';

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_FOLLOWER_COUNT ? parsed : 'invalid';
}

/** A percentage without the sign. `"4.27"` means 4.27%. */
/**
 * Upper bound for an engagement rate.
 *
 * The v1 formulas divided by the follower count, so a rate above 100% meant a
 * typo. The v2 formula divides by median views, and a post can gather more
 * likes, comments, saves and shares than the median view count of the sample.
 * A rate above 100% is therefore unusual but real, and must not be rejected
 * when it comes from a receipt-backed fetch. The ceiling stays only to catch a
 * typed mistake such as 5000.
 */
export const MAX_ENGAGEMENT_RATE = 1000;

export function parseEngagementRate(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;

  // A single trailing percent sign is accepted, because the pitch modal field
  // is labelled "Engagement Rate (%)" and admins type it.
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim().replace(/\s*%$/, '').trim()
        : null;
  if (raw === null) return 'invalid';
  if (raw === '') return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return 'invalid';

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_ENGAGEMENT_RATE) return 'invalid';
  return parsed.toFixed(2);
}

/** Largest Recent Views value accepted for a Threads creator. */
export const MAX_RECENT_VIEWS = 1_000_000_000_000;

export const ENGAGEMENT_RATE_INVALID_MESSAGE = 'Engagement rate must be a percentage between 0 and 100.';
export const RECENT_VIEWS_INVALID_MESSAGE = 'Enter recent views as a whole number, for example 1,300,000 or 1.3M.';

const VIEWS_SUFFIX: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

/**
 * Threads Recent Views, typed by an admin from the Threads app.
 *
 * Accepts `1300000`, `1,300,000`, `1.3M`, `850k`, and `1.3M recent views`.
 * Returns a whole-number digit string, never a percent. Threads hides this
 * number from logged-out visitors, so it is never fetched.
 */
export function parseRecentViews(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_RECENT_VIEWS ? String(value) : 'invalid';
  }
  if (typeof value !== 'string') return 'invalid';
  if (value.trim() === '') return null;

  const raw = value.replace(/[,\s]/g, '').replace(/(?:recent)?views$/i, '');
  let parsed: number;
  if (/^\d+$/.test(raw)) {
    parsed = Number(raw);
  } else {
    const short = /^(\d+(?:\.\d+)?)([kmb])$/i.exec(raw);
    if (!short) return 'invalid';
    parsed = Math.round(Number(short[1]) * VIEWS_SUFFIX[short[2].toLowerCase()]);
  }
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_RECENT_VIEWS ? String(parsed) : 'invalid';
}

/**
 * The platform's primary metric, carried in the engagement-rate fields:
 * Recent Views on Threads, the engagement rate percent everywhere else.
 */
export function parsePrimaryMetric(platform: string | null | undefined, value: unknown): string | null | 'invalid' {
  return platform === 'threads' ? parseRecentViews(value) : parseEngagementRate(value);
}

export function primaryMetricInvalidMessage(platform: string | null | undefined): string {
  return platform === 'threads' ? RECENT_VIEWS_INVALID_MESSAGE : ENGAGEMENT_RATE_INVALID_MESSAGE;
}

/* --------------------------------------------------------------- names */

/** Username half of `instagram:handle`. Used when scrape has not named the guest yet. */
export function usernameFromCanonicalKey(canonicalKey: string): string {
  const colon = canonicalKey.indexOf(':');
  return colon === -1 ? canonicalKey : canonicalKey.slice(colon + 1);
}

export function displayNameFromProfile(canonicalKey: string, submittedName: string): string {
  const trimmed = submittedName.trim();
  return trimmed || usernameFromCanonicalKey(canonicalKey);
}

/** True when the batch came from the automatic dialog, including an in-flight scrape. */
export function isAutomaticGuestBatch(guests: readonly SubmittedGuest[]): boolean {
  return guests.some(
    (guest) => Boolean(guest?.completionReceipt) || Boolean(guest?.fallbackReason) || Boolean(guest?.extractionId),
  );
}

/* ------------------------------------------------------------ eligibility */

export interface ValidateContext {
  requesterUserId: string;
  campaignId: string;
  receiptSecret: string;
  now?: Date;
  /** Reads the extraction rows the receipts point at. */
  loadExtraction(id: string): Promise<any | null>;
}

export interface ValidateResult {
  accepted: AcceptedGuest[];
  rejected: RejectedGuest[];
}

function extractionOwnedByRequester(
  extraction: { requestedByUserId?: string; campaignId?: string; canonicalProfileKey?: string },
  context: ValidateContext,
  canonicalKey: string,
): boolean {
  return (
    extraction.requestedByUserId === context.requesterUserId &&
    extraction.campaignId === context.campaignId &&
    extraction.canonicalProfileKey === canonicalKey
  );
}

function readyExtractionFields(extraction: {
  id: string;
  receiptNonce: string;
  actorId: string;
  actorBuild: string;
  actorRunId?: string | null;
  formulaVersion?: string | null;
}): AcceptedExtraction {
  return {
    kind: 'ready',
    id: extraction.id,
    nonce: extraction.receiptNonce,
    actorId: extraction.actorId,
    actorBuild: extraction.actorBuild,
    actorRunId: extraction.actorRunId ?? null,
    formulaVersion: extraction.formulaVersion ?? null,
  };
}

/**
 * Decide which submitted rows may be saved.
 *
 * Three kinds pass: a READY row with a valid receipt, an in-flight extraction
 * the requester owns, or an explicitly confirmed fallback for a permitted
 * reason with a name and a follower count.
 */
export async function validateSubmittedGuests(
  guests: readonly SubmittedGuest[],
  context: ValidateContext,
): Promise<ValidateResult> {
  const accepted: AcceptedGuest[] = [];
  const rejected: RejectedGuest[] = [];
  const seenKeys = new Set<string>();

  for (const guest of guests) {
    const reject = (code: GuestRejectionCode, message: string) =>
      rejected.push({ profileLink: guest.profileLink, code, message });

    const normalized = normalizeProfileUrl(guest.profileLink ?? '');
    if (!normalized.ok) {
      reject('INVALID_PROFILE_LINK', normalized.message);
      continue;
    }
    const profile = normalized.profile;

    if (seenKeys.has(profile.canonicalKey)) {
      reject('DUPLICATE_PROFILE', 'This creator appears more than once in the batch.');
      continue;
    }

    let follower = parseFollowerCount(guest.followerCount);
    let rate = parsePrimaryMetric(profile.platform, guest.engagementRate);
    // An in-flight attach ignores client-typed numbers, including junk left
    // in the modal. A receipt-backed row still rejects a bad override.
    // Threads Recent Views is the exception: no fetch will fill it, so a bad
    // typed value is rejected rather than silently dropped.
    if (guest.extractionId && !guest.completionReceipt) {
      if (follower === 'invalid') follower = null;
      if (rate === 'invalid' && profile.platform !== 'threads') rate = null;
    }
    if (follower === 'invalid') {
      reject('INVALID_FOLLOWER_COUNT', 'Follower count must be a whole number above zero.');
      continue;
    }
    if (rate === 'invalid') {
      reject('INVALID_ENGAGEMENT_RATE', primaryMetricInvalidMessage(profile.platform));
      continue;
    }
    // Threads Recent Views is never fetched, so a typed value is kept even on
    // an in-flight attach, where every other typed number gives way to the fetch.
    const typedRecentViews = profile.platform === 'threads' ? rate : null;
    const name = (guest.name ?? '').trim();
    const adminComments = (guest.adminComments ?? '').trim() || null;

    if (guest.completionReceipt) {
      // eslint-disable-next-line no-await-in-loop
      const extraction = await context.loadExtraction(guest.extractionId ?? '');
      if (!extraction) {
        reject('EXTRACTION_NOT_FOUND', 'The fetched result could not be found. Fetch the details again.');
        continue;
      }
      if (extraction.status !== 'READY' || !extraction.receiptNonce) {
        reject('EXTRACTION_NOT_READY', 'That result is no longer usable. Fetch the details again.');
        continue;
      }

      const verified = verifyReceipt(guest.completionReceipt, {
        secret: context.receiptSecret,
        now: context.now,
        expected: {
          requesterUserId: context.requesterUserId,
          campaignId: context.campaignId,
          canonicalProfileKey: profile.canonicalKey,
          platform: profile.platform,
          actorId: extraction.actorId,
          actorBuild: extraction.actorBuild,
          formulaVersion: extraction.formulaVersion,
          resultDigest: extraction.receiptDigest,
          extractionId: extraction.id,
        },
      });

      if (!verified.ok) {
        reject('RECEIPT_INVALID', verified.message);
        continue;
      }
      if (!name) {
        reject('MISSING_NAME', 'A creator name is required.');
        continue;
      }

      seenKeys.add(profile.canonicalKey);
      accepted.push({
        canonicalProfileKey: profile.canonicalKey,
        canonicalProfileUrl: profile.canonicalUrl,
        rawProfileLink: guest.profileLink,
        platform: profile.platform,
        name,
        followerCount: follower,
        engagementRate: rate,
        adminComments,
        extraction: readyExtractionFields(extraction),
        baseline: {
          name: extraction.resultName ?? null,
          followerCount: extraction.resultFollowerCount ?? null,
          engagementRate: extraction.resultEngagementRate ?? null,
        },
        fallbackReason: null,
      });
      continue;
    }

    if (guest.extractionId) {
      // eslint-disable-next-line no-await-in-loop
      const extraction = await context.loadExtraction(guest.extractionId);
      if (!extraction) {
        reject('EXTRACTION_NOT_FOUND', 'The fetch for this profile could not be found.');
        continue;
      }
      if (!extractionOwnedByRequester(extraction, context, profile.canonicalKey)) {
        reject('EXTRACTION_NOT_ATTACHABLE', 'This fetch does not belong to this campaign and admin.');
        continue;
      }

      const resolvedName = displayNameFromProfile(profile.canonicalKey, name);
      const attachable = (ATTACHABLE_STATUSES as readonly string[]).includes(extraction.status);
      const readyToCopy = extraction.status === 'READY' && typeof extraction.receiptNonce === 'string';

      if (readyToCopy) {
        seenKeys.add(profile.canonicalKey);
        accepted.push({
          canonicalProfileKey: profile.canonicalKey,
          canonicalProfileUrl: profile.canonicalUrl,
          rawProfileLink: guest.profileLink,
          platform: profile.platform,
          name: resolvedName || extraction.resultName || usernameFromCanonicalKey(profile.canonicalKey),
          followerCount: extraction.resultFollowerCount ?? null,
          engagementRate: extraction.resultEngagementRate ?? typedRecentViews,
          adminComments,
          extraction: readyExtractionFields(extraction),
          baseline: {
            name: extraction.resultName ?? null,
            followerCount: extraction.resultFollowerCount ?? null,
            engagementRate: extraction.resultEngagementRate ?? null,
          },
          fallbackReason: null,
        });
        continue;
      }

      if (!attachable) {
        reject('EXTRACTION_NOT_ATTACHABLE', 'This fetch can no longer be used. Fetch the details again.');
        continue;
      }

      seenKeys.add(profile.canonicalKey);
      accepted.push({
        canonicalProfileKey: profile.canonicalKey,
        canonicalProfileUrl: profile.canonicalUrl,
        rawProfileLink: guest.profileLink,
        platform: profile.platform,
        name: resolvedName,
        followerCount: null,
        engagementRate: typedRecentViews,
        adminComments,
        extraction: {
          kind: 'pending',
          id: extraction.id,
          nonce: null,
          actorId: extraction.actorId ?? null,
          actorBuild: extraction.actorBuild ?? null,
          actorRunId: extraction.actorRunId ?? null,
          formulaVersion: extraction.formulaVersion ?? null,
        },
        baseline: { name: null, followerCount: null, engagementRate: null },
        fallbackReason: null,
      });
      continue;
    }

    // No receipt and no in-flight fetch. The only other way in is a confirmed fallback.
    const reason = guest.fallbackReason ?? null;
    if (!reason || !(ALLOWED_FALLBACK_REASONS as readonly string[]).includes(reason)) {
      reject('FALLBACK_NOT_ALLOWED', 'This row has no verified result and no permitted manual fallback.');
      continue;
    }
    if (guest.fallbackConfirmed !== true) {
      reject('FALLBACK_NOT_CONFIRMED', 'Confirm the manual entry before saving this creator.');
      continue;
    }
    if (!name) {
      reject('MISSING_NAME', 'A creator name is required.');
      continue;
    }
    if (follower === null) {
      reject('INVALID_FOLLOWER_COUNT', 'A manual entry needs a follower count.');
      continue;
    }

    seenKeys.add(profile.canonicalKey);
    accepted.push({
      canonicalProfileKey: profile.canonicalKey,
      canonicalProfileUrl: profile.canonicalUrl,
      rawProfileLink: guest.profileLink,
      platform: profile.platform,
      name,
      followerCount: follower,
      // A manual fallback may leave the rate blank.
      engagementRate: rate,
      adminComments,
      extraction: null,
      baseline: { name: null, followerCount: null, engagementRate: null },
      fallbackReason: reason,
    });
  }

  return { accepted, rejected };
}

/** Provenance for one accepted row, ready for the audit table. */
export function provenanceFor(guest: AcceptedGuest) {
  return classifyMetricProvenance({
    receiptVerified: guest.extraction?.kind === 'ready',
    original: guest.baseline,
    final: { name: guest.name, followerCount: guest.followerCount, engagementRate: guest.engagementRate },
    fallbackReason: guest.fallbackReason,
    platform: guest.platform,
  });
}

/* --------------------------------------------------------- nonce claiming */

export class ReceiptAlreadyUsedError extends Error {
  readonly code = 'RECEIPT_ALREADY_USED';

  constructor(profileLabel: string) {
    super(`This fetched result was already used for ${profileLabel}.`);
    this.name = 'ReceiptAlreadyUsedError';
  }
}

/**
 * Spend a receipt exactly once, inside the create transaction.
 *
 * The conditional `updateMany` is the whole guarantee: only the first caller
 * matches `receiptConsumedAt: null`, so a replay or a concurrent batch updates
 * zero rows and throws. Nothing is claimed before the transaction commits,
 * because a throw here rolls the transaction back.
 */
export async function claimReceiptNonce(
  tx: {
    guestProfileExtraction: { updateMany(args: { where: any; data: any }): Promise<{ count: number }> };
  },
  input: { extractionId: string; nonce: string; profileLabel: string; now?: Date },
): Promise<void> {
  const claimed = await tx.guestProfileExtraction.updateMany({
    where: { id: input.extractionId, receiptNonce: input.nonce, receiptConsumedAt: null },
    data: { receiptConsumedAt: input.now ?? new Date() },
  });

  if (claimed.count !== 1) {
    throw new ReceiptAlreadyUsedError(input.profileLabel);
  }
}

/* ----------------------------------------------------------- idempotency */

/** Stable hash of what was asked for, so a replay can be told from a change. */
export function hashCreateRequest(campaignId: string, guests: readonly SubmittedGuest[]): string {
  const identityOf = (link: string | null | undefined): string => {
    const result = normalizeProfileUrl(link ?? '');
    return result.ok ? result.profile.canonicalKey : (link ?? '').trim();
  };

  const normalized = guests
    .map((guest) => ({
      profileLink: identityOf(guest.profileLink),
      name: (guest.name ?? '').trim(),
      followerCount: String(guest.followerCount ?? ''),
      engagementRate: String(guest.engagementRate ?? ''),
      adminComments: (guest.adminComments ?? '').trim(),
      extractionId: guest.extractionId ?? '',
      fallbackReason: guest.fallbackReason ?? '',
      fallbackConfirmed: guest.fallbackConfirmed === true,
    }))
    .sort((a, b) => a.profileLink.localeCompare(b.profileLink));

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ campaignId, guests: normalized }))
    .digest('hex');
}

export type IdempotencyOutcome =
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'conflict'; message: string }
  | { kind: 'proceed'; recordId: string | null };

/**
 * Same key and same body replays the saved response. Same key and a different
 * body is a conflict, never a second create.
 */
export async function resolveCreateIdempotency(
  input: { performedByUserId: string; campaignId: string; idempotencyKey: string; requestHash: string },
  store: {
    guestCreatorCreateRequest: {
      findUnique(args: { where: any }): Promise<any | null>;
      create(args: { data: any }): Promise<any>;
    };
  },
): Promise<IdempotencyOutcome> {
  const existing = await store.guestCreatorCreateRequest.findUnique({
    where: {
      performedByUserId_operation_idempotencyKey: {
        performedByUserId: input.performedByUserId,
        operation: GUEST_CREATE_OPERATION,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (!existing) return { kind: 'proceed', recordId: null };

  if (existing.requestHash !== input.requestHash) {
    return { kind: 'conflict', message: 'This idempotency key was already used for a different request.' };
  }
  if (existing.status === 'COMPLETED') {
    return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody };
  }
  return { kind: 'proceed', recordId: existing.id };
}

/* ---------------------------------------------------------- manual mode */

/**
 * The separate manual mode, kept working for existing callers.
 *
 * It accepts any profile link, including one outside Instagram and TikTok, so
 * the current non-platform dialog keeps working. It still validates numbers
 * and still writes provenance. Its metrics are manual or unavailable. They are
 * never automatic, because there is no receipt.
 */
export function validateManualGuests(guests: readonly SubmittedGuest[]): ValidateResult {
  const accepted: AcceptedGuest[] = [];
  const rejected: RejectedGuest[] = [];
  const seen = new Set<string>();

  for (const guest of guests) {
    const link = (guest.profileLink ?? '').trim();
    const name = (guest.name ?? '').trim();
    const reject = (code: GuestRejectionCode, message: string) => rejected.push({ profileLink: link, code, message });

    if (!link) {
      reject('INVALID_PROFILE_LINK', 'A profile link is required.');
      continue;
    }
    if (!name) {
      reject('MISSING_NAME', 'A creator name is required.');
      continue;
    }

    // A canonical link decides the platform. Only a link this backend cannot
    // canonicalize falls back to what the admin picked.
    const normalized = normalizeProfileUrl(link);
    const submitted = (guest.selectedPlatform ?? '').trim().toLowerCase();
    const fallbackPlatform: SupportedPlatform | null =
      submitted === 'tiktok' || submitted === 'instagram' || submitted === 'threads' ? submitted : null;
    const platform = normalized.ok ? normalized.profile.platform : fallbackPlatform;

    const follower = parseFollowerCount(guest.followerCount);
    if (follower === 'invalid') {
      reject('INVALID_FOLLOWER_COUNT', 'Follower count must be a whole number above zero.');
      continue;
    }
    const rate = parsePrimaryMetric(platform, guest.engagementRate);
    if (rate === 'invalid') {
      reject('INVALID_ENGAGEMENT_RATE', primaryMetricInvalidMessage(platform));
      continue;
    }

    const identity = normalized.ok ? normalized.profile.canonicalKey : link.toLowerCase();
    if (seen.has(identity)) {
      reject('DUPLICATE_PROFILE', 'This creator appears more than once in the batch.');
      continue;
    }
    seen.add(identity);

    accepted.push({
      canonicalProfileKey: normalized.ok ? normalized.profile.canonicalKey : null,
      canonicalProfileUrl: normalized.ok ? normalized.profile.canonicalUrl : null,
      rawProfileLink: link,
      platform,
      name,
      followerCount: follower,
      engagementRate: rate,
      adminComments: (guest.adminComments ?? '').trim() || null,
      // No receipt in manual mode, so never automatic.
      extraction: null,
      baseline: { name: null, followerCount: null, engagementRate: null },
      fallbackReason: null,
    });
  }

  return { accepted, rejected };
}
