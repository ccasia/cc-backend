import { z } from 'zod';

import type { AdapterInput, AdapterResult, ExtractedProfile } from '@/src/types/guestProfileExtraction';
import {
  asArray,
  errorRowFailure,
  fail,
  imageUrl,
  normalizeHandle,
  profileCount,
  runFailure,
  text,
} from './adapterShared';

/**
 * Adapter for Bright Data's "Threads - Profiles" dataset (`gd_mde7jg3ld2h3hnnf2`).
 *
 * Profile only. Threads hides Recent Views from logged-out visitors, so no
 * posts are read and no rate is computed; the admin types Recent Views.
 *
 * Measured on @pandapandiy_ 2026-11-18: `{ url, profile_name: null,
 * about_formatted, number_of_followers: 36, profile_picture, threads: [...] }`.
 * The row has no handle field, so the handle is read from `url`.
 */

const HANDLE_IN_URL = /threads\.(?:com|net)\/@([^/?#]+)/i;

const handleFromUrl = (url: string): string | null => HANDLE_IN_URL.exec(url)?.[1] ?? null;

const profileSchema = z.object({
  url: z.string().min(1),
  profile_name: text,
  about_formatted: text,
  number_of_followers: profileCount,
  profile_picture: imageUrl.optional(),
});

type ProfileItem = z.infer<typeof profileSchema>;

export function parseThreadsOutput(input: AdapterInput): AdapterResult {
  const runError = runFailure(input);
  if (runError) return runError;

  const expected = normalizeHandle(input.expectedUsername);
  const items = asArray(input.items);

  const parsed = items
    .map((item) => profileSchema.safeParse(item))
    .flatMap((result) => (result.success ? [result.data] : []));
  const owner = parsed.find((row) => {
    const handle = handleFromUrl(row.url);
    return handle !== null && normalizeHandle(decodeHandle(handle)) === expected;
  });

  if (owner) return { ok: true, profile: toProfile(expected, owner), candidates: [] };

  const errorRow = errorRowFailure(items);
  if (errorRow) return errorRow;

  if (items.length === 0) {
    return fail('PROFILE_NOT_FOUND', `The provider returned no profile for ${expected}.`);
  }
  if (parsed.some((row) => handleFromUrl(row.url) !== null)) {
    return fail('PROFILE_NOT_FOUND', `The provider returned a different Threads profile, not ${expected}.`);
  }
  return fail('PROVIDER_SCHEMA_CHANGED', 'The Threads profile output carried no item with a profile `url`.');
}

function decodeHandle(handle: string): string {
  try {
    return decodeURIComponent(handle);
  } catch {
    return handle;
  }
}

function toProfile(expected: string, row: ProfileItem): ExtractedProfile {
  return {
    platform: 'threads',
    username: expected,
    displayName: row.profile_name,
    biography: row.about_formatted,
    profilePictureUrl: row.profile_picture ?? null,
    followerCount: row.number_of_followers,
    isPrivate: false,
  };
}
