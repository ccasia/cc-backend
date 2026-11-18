import type {
  CanonicalProfile,
  NormalizeProfileUrlResult,
  ProfileUrlRejectionCode,
  SupportedPlatform,
} from '@/src/types/guestProfileExtraction';

/**
 * Canonicalize a permitted public profile URL.
 *
 * Platform is derived here and nowhere else. A client-supplied platform is
 * always ignored. The backend never fetches the supplied URL; it only parses it.
 */

const HOSTS: Record<string, SupportedPlatform> = {
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'threads.com': 'threads',
  'www.threads.com': 'threads',
  'threads.net': 'threads',
  'www.threads.net': 'threads',
};

/** Platforms whose profile path is `@name`. */
const AT_PREFIXED: ReadonlySet<SupportedPlatform> = new Set(['tiktok', 'threads']);

const AT_REQUIRED_MESSAGE: Record<SupportedPlatform, string> = {
  instagram: '',
  tiktok: 'A TikTok profile link contains @ before the name.',
  threads: 'A Threads profile link contains @ before the name.',
};

/** Path segments that are product pages, not profiles. */
const RESERVED: Record<SupportedPlatform, ReadonlySet<string>> = {
  instagram: new Set([
    'p',
    'reel',
    'reels',
    'tv',
    'stories',
    'explore',
    'accounts',
    'direct',
    'about',
    'developer',
    'legal',
    'privacy',
    'terms',
    'session',
    'challenge',
    'emails',
    'push',
    'web',
    'graphql',
    'api',
    'oauth',
    'ajax',
    'topics',
  ]),
  tiktok: new Set([
    'video',
    'photo',
    'tag',
    'music',
    'discover',
    'foryou',
    'following',
    'live',
    'upload',
    'search',
    'explore',
    'about',
    'legal',
    'privacy',
    'terms',
    'business',
    'embed',
    'api',
    'node',
    'passport',
    'login',
  ]),
  threads: new Set([
    'search',
    'activity',
    'login',
    'settings',
    'about',
    'legal',
    'privacy',
    'terms',
    't',
    'post',
    'intent',
    'api',
  ]),
};

const USERNAME: Record<SupportedPlatform, RegExp> = {
  // Instagram allows letters, digits, periods and underscores, up to 30.
  instagram: /^[a-z0-9._]{1,30}$/,
  // TikTok allows letters, digits, periods and underscores, up to 24.
  tiktok: /^[a-z0-9._]{1,24}$/,
  // Threads handles are Instagram handles.
  threads: /^[a-z0-9._]{1,30}$/,
};

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const reject = (code: ProfileUrlRejectionCode, message: string): NormalizeProfileUrlResult => ({
  ok: false,
  code,
  message,
});

function isValidUsername(platform: SupportedPlatform, username: string): boolean {
  if (!USERNAME[platform].test(username)) return false;
  // A username that is only punctuation, or that starts, ends, or doubles a
  // period, is not a real handle on either platform.
  if (username.startsWith('.') || username.endsWith('.')) return false;
  if (username.includes('..')) return false;
  if (!/[a-z0-9_]/.test(username)) return false;
  return true;
}

export function normalizeProfileUrl(input: string): NormalizeProfileUrlResult {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return reject('EMPTY', 'Enter a profile link.');

  if (HAS_SCHEME.test(raw) && !/^https?:/i.test(raw)) {
    return reject('UNSUPPORTED_SCHEME', 'Use an http or https profile link.');
  }

  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return reject('MALFORMED_URL', 'This is not a valid link.');
  }

  if (url.username || url.password) {
    return reject('USERINFO_NOT_ALLOWED', 'Remove the user name and password from the link.');
  }
  if (url.port) {
    return reject('PORT_NOT_ALLOWED', 'Remove the port from the link.');
  }

  const platform = HOSTS[url.hostname.toLowerCase()];
  if (!platform) {
    return reject('UNSUPPORTED_HOST', 'Use an Instagram, TikTok, or Threads profile link.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) {
    return reject(
      'NOT_A_PROFILE_URL',
      segments.length === 0 ? 'This link has no profile name.' : 'Use the profile link, not a post link.',
    );
  }

  const [segment] = segments;
  let username: string;

  const atPrefixed = AT_PREFIXED.has(platform);
  if (atPrefixed) {
    if (!segment.startsWith('@')) {
      return reject('NOT_A_PROFILE_URL', AT_REQUIRED_MESSAGE[platform]);
    }
    username = decodeURIComponent(segment.slice(1)).toLowerCase();
  } else {
    username = decodeURIComponent(segment).toLowerCase();
  }

  if (RESERVED[platform].has(username)) {
    return reject('NOT_A_PROFILE_URL', 'Use the profile link, not a page link.');
  }
  if (!isValidUsername(platform, username)) {
    return reject('INVALID_USERNAME', 'This profile name is not valid.');
  }

  // Query and fragment may be supplied. They are not part of identity.
  const path = atPrefixed ? `@${username}` : username;
  const profile: CanonicalProfile = {
    platform,
    username,
    canonicalUrl: `https://www.${platform}.com/${path}`,
    canonicalKey: `${platform}:${username}`,
  };

  return { ok: true, profile };
}

/** Derived platform for a link, or null when the link is not permitted. */
export function derivePlatform(input: string): SupportedPlatform | null {
  const result = normalizeProfileUrl(input);
  return result.ok ? result.profile.platform : null;
}

/** True when two links name the same creator. */
export function isSameProfile(a: string, b: string): boolean {
  const left = normalizeProfileUrl(a);
  const right = normalizeProfileUrl(b);
  return left.ok && right.ok && left.profile.canonicalKey === right.profile.canonicalKey;
}
