import crypto from 'crypto';

import type {
  MetricBaseline,
  ReceiptBindings,
  ReceiptPayload,
  ReceiptVerifyResult,
} from '@/src/types/guestProfileExtraction';

/**
 * Signed, expiring, requester-bound completion receipts.
 *
 * A receipt proves one thing: this backend produced this baseline, for this
 * admin, on this campaign, from this actor build and formula version. It does
 * not freeze the final values. The admin may edit them; the create path then
 * records a manual override.
 *
 * The nonce is single use. It is consumed inside the create transaction, never
 * before. This module only issues and verifies.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

/** Stable key order, so the same values always give the same bytes. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function getReceiptSecret(): string {
  const secret = process.env.ENGAGEMENT_RECEIPT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ENGAGEMENT_RECEIPT_SECRET is missing or too short. Generate one with: openssl rand -hex 32');
  }
  return secret;
}

/** Digest of the fetched baseline the receipt attests to. */
export function digestResult(input: {
  baseline: MetricBaseline;
  sampleSize: number;
  postIds: readonly string[];
}): string {
  return crypto
    .createHash('sha256')
    .update(
      canonicalJson({
        name: input.baseline.name,
        followerCount: input.baseline.followerCount,
        engagementRate: input.baseline.engagementRate,
        sampleSize: input.sampleSize,
        postIds: [...input.postIds].sort(),
      }),
    )
    .digest('hex');
}

export const createReceiptNonce = (): string => crypto.randomBytes(24).toString('hex');

function sign(payloadJson: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadJson).digest());
}

export function issueReceipt(
  bindings: ReceiptBindings,
  options: { secret?: string; nonce?: string; now?: Date; ttlMs?: number } = {},
): { token: string; payload: ReceiptPayload } {
  const secret = options.secret ?? getReceiptSecret();
  const now = options.now ?? new Date();
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

  const payload: ReceiptPayload = {
    v: 1,
    ...bindings,
    nonce: options.nonce ?? createReceiptNonce(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
  };

  const payloadJson = canonicalJson(payload);
  const token = `${b64url(Buffer.from(payloadJson, 'utf8'))}.${sign(payloadJson, secret)}`;
  return { token, payload };
}

const BINDING_FIELDS: readonly (keyof ReceiptBindings)[] = [
  'requesterUserId',
  'campaignId',
  'canonicalProfileKey',
  'platform',
  'actorId',
  'actorBuild',
  'formulaVersion',
  'resultDigest',
  'extractionId',
];

/**
 * Verify a receipt before the create transaction.
 *
 * Every binding must match. A receipt issued for another admin, another
 * campaign, another profile, another actor build, or another formula version
 * is rejected. So is a forged or expired one.
 */
export function verifyReceipt(
  token: string | null | undefined,
  options: { expected: ReceiptBindings; secret?: string; now?: Date },
): ReceiptVerifyResult {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, code: 'MISSING', message: 'No receipt was supplied.' };
  }

  const secret = options.secret ?? getReceiptSecret();
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, code: 'MALFORMED', message: 'The receipt is not in the expected form.' };
  }

  const [encodedPayload, signature] = parts;
  let payloadJson: string;
  let payload: ReceiptPayload;
  try {
    payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson) as ReceiptPayload;
  } catch {
    return { ok: false, code: 'MALFORMED', message: 'The receipt payload could not be read.' };
  }

  // Sign the re-serialized payload, so a reordered or padded copy cannot pass.
  const expectedSignature = sign(canonicalJson(payload), secret);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expectedSignature);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    return { ok: false, code: 'BAD_SIGNATURE', message: 'The receipt signature is not valid.' };
  }

  if (payload.v !== 1) {
    return { ok: false, code: 'MALFORMED', message: `Receipt version ${String(payload.v)} is not supported.` };
  }

  const now = (options.now ?? new Date()).getTime();
  const expiresAt = Date.parse(payload.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= now) {
    return { ok: false, code: 'EXPIRED', message: 'The receipt has expired. Fetch the details again.' };
  }

  for (const field of BINDING_FIELDS) {
    if (payload[field] !== options.expected[field]) {
      return {
        ok: false,
        code: 'BINDING_MISMATCH',
        field,
        message: `The receipt was not issued for this ${field}.`,
      };
    }
  }

  return { ok: true, payload };
}
