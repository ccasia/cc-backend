import { z } from 'zod';

import type { AdapterFailureCode, AdapterInput, AdapterResult } from '@/src/types/guestProfileExtraction';

/**
 * Shared boundary helpers for actor adapters.
 *
 * Provider output enters as `unknown`. Nothing downstream sees it until one
 * adapter has turned it into typed domain values, or has failed closed with
 * `PROVIDER_SCHEMA_CHANGED`.
 */

export const fail = (code: AdapterFailureCode, message: string): AdapterResult => ({ ok: false, code, message });

/** A counter the provider may omit. Absent stays absent; it never becomes 0. */
export const counter = z
  .number()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

export const flag = z
  .boolean()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

export const text = z
  .string()
  .nullish()
  .transform((v) => (v === undefined ? null : v));

export const asArray = (items: unknown): unknown[] => (Array.isArray(items) ? items : []);

export const normalizeHandle = (value: string): string => value.trim().toLowerCase().replace(/^@/, '');

/** A run that failed never reaches an adapter's parsing rules. */
export function runFailure(input: AdapterInput): AdapterResult | null {
  if (!input.error) return null;
  const code = typeof input.error.code === 'string' ? input.error.code : 'UNKNOWN';
  const message = typeof input.error.message === 'string' ? input.error.message : 'The provider run failed.';
  return fail('PROVIDER_FAILURE', `${code}: ${message}`);
}

/** Provider error items, which are data rather than a failed run. */
const errorItemSchema = z.object({
  error: z.string(),
  errorDescription: z.string().nullish(),
  errorMessage: z.string().nullish(),
});

const NOT_FOUND = /not[_ -]?found|does not exist|USER_NOT_FOUND/i;

export function errorItemFailure(items: unknown[]): AdapterResult | null {
  for (const item of items) {
    const parsed = errorItemSchema.safeParse(item);
    if (!parsed.success) continue;

    const { error, errorDescription, errorMessage } = parsed.data;
    const detail = errorDescription ?? errorMessage ?? error;
    if (NOT_FOUND.test(error)) return fail('PROFILE_NOT_FOUND', detail);
    return fail('PROVIDER_FAILURE', `${error}: ${detail}`);
  }
  return null;
}
