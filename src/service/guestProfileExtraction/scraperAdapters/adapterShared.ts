import { z } from 'zod';

import type { AdapterFailureCode, AdapterInput, AdapterResult } from '@/src/types/guestProfileExtraction';

/**
 * Shared boundary helpers for scraper adapters.
 *
 * Provider output enters as `unknown`. Nothing downstream sees it until one
 * adapter has turned it into typed domain values, or has failed closed with
 * `PROVIDER_SCHEMA_CHANGED`.
 */

export const fail = (code: AdapterFailureCode, message: string): AdapterResult => ({ ok: false, code, message });

const SUFFIX: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

/**
 * Read one provider count. Absent is `null` and never becomes 0. A value in a
 * format this does not know is `NaN`, so the valid-post policy rejects the
 * post as INVALID_COUNTER and keeps it visible with that reason. It never
 * makes the whole post disappear.
 *
 * Bright Data mixes types for the same field (TikTok `share_count` is `"344"`
 * in one example and `344` in another), so these string forms are read:
 *  - `"344"`, and `"1,200"` with commas as thousands separators;
 *  - `"1.2K"`, `"3.4M"`, `"1B"` (any case). Such a value is rounded at the
 *    source, but no more than TikTok's own counts: both providers already
 *    return `1,700,000` views, which is "1.7M" written in digits.
 * Everything else is refused rather than guessed at: `"1,2K"` (a decimal
 * comma, so it could mean 1.2K or 12K), other languages' units (`"1.2万"`),
 * `""`, `"-1"`, `"N/A"`. A number is passed through as is; the policy checks
 * that it is a safe non-negative integer.
 */
export function parseCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;

  const raw = value.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) return Number(raw.replace(/,/g, ''));

  const short = /^(\d+(?:\.\d+)?)\s*([kmb])$/i.exec(raw);
  if (short) {
    const count = Math.round(Number(short[1]) * SUFFIX[short[2].toLowerCase()]);
    return Number.isSafeInteger(count) ? count : Number.NaN;
  }
  return Number.NaN;
}

/** A post counter. Unreadable values become `NaN`; see `parseCount`. */
export const counter = z.unknown().optional().transform(parseCount);

/**
 * A follower count. Unreadable becomes `null` (unknown), never `NaN`: it is
 * written to an integer column, and followers are not part of the rate.
 */
export const profileCount = z
  .unknown()
  .optional()
  .transform((value) => {
    const count = parseCount(value);
    return count !== null && Number.isSafeInteger(count) && count >= 0 ? count : null;
  });

export const flag = z
  .boolean()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

export const text = z
  .string()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

/**
 * Optional image data must not make valid metric data fail parsing.
 *
 * HTTPS only, no credentials. Anything else becomes null rather than failing
 * the post, because a thumbnail is display data, not a metric.
 */
export const imageUrl = z.unknown().transform((value): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
});

export const asArray = (items: unknown): unknown[] => (Array.isArray(items) ? items : []);

export const normalizeHandle = (value: string): string => value.trim().toLowerCase().replace(/^@/, '');

/** A job that failed never reaches an adapter's parsing rules. */
export function runFailure(input: AdapterInput): AdapterResult | null {
  if (!input.error) return null;
  const code = typeof input.error.code === 'string' ? input.error.code : 'UNKNOWN';
  const message = typeof input.error.message === 'string' ? input.error.message : 'The provider job failed.';
  return fail('PROVIDER_FAILURE', `${code}: ${message}`);
}

/**
 * A Bright Data error row. With `include_errors=true` a failed input comes
 * back as a row in the snapshot rather than as a failed job, for example
 * `{ "error": "...", "error_code": "dead_page", "input": { "url": "..." } }`.
 */
const errorRowSchema = z
  .object({
    error: z.string().nullish(),
    error_code: z.string().nullish(),
    warning: z.string().nullish(),
    warning_code: z.string().nullish(),
  })
  .refine((row) => !!(row.error || row.error_code), { message: 'not an error row' });

const NOT_FOUND = /dead[_ -]?page|not[_ -]?found|does not exist|doesn't exist|unavailable|no such/i;
const PRIVATE = /private/i;

export const isErrorRow = (item: unknown): boolean => errorRowSchema.safeParse(item).success;

/** Map the first error row, if any, to a failure the admin can act on. */
export function errorRowFailure(items: unknown[]): AdapterResult | null {
  for (const item of items) {
    const parsed = errorRowSchema.safeParse(item);
    if (!parsed.success) continue;

    const { error, error_code: errorCode } = parsed.data;
    const detail = [errorCode, error].filter(Boolean).join(': ');
    if (PRIVATE.test(detail)) return fail('PRIVATE_PROFILE', detail);
    if (NOT_FOUND.test(detail)) return fail('PROFILE_NOT_FOUND', detail);
    return fail('PROVIDER_FAILURE', detail);
  }
  return null;
}
