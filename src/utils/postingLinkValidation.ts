export const MAX_POSTING_LINKS = 2;

/** A posting link problem the user can fix; the message is shown to them as-is. */
export class PostingLinkError extends Error {}

const TIKTOK_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'];
const INSTAGRAM_HOSTS = ['instagram.com', 'www.instagram.com', 'm.instagram.com'];

const KNOWN_HOST_WITHOUT_SCHEME = /^(?:(?:www|m|vm|vt)\.)?(?:tiktok|instagram)\.com(?:[/?#]|$)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const TIKTOK_POST_PATH = /^\/@[^/]+\/(?:video|photo)\/\d+/;
const TIKTOK_SHORT_PATH = /^\/t\/[\w-]+/;
const INSTAGRAM_POST_PATH = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]+/;

/**
 * Validates one TikTok / Instagram post link and returns it normalised: https:// added when
 * missing, http upgraded. Throws PostingLinkError with a message the user can act on.
 */
export function normalizePostingLink(rawLink: string): string {
  let value = rawLink.trim();

  const notALink = new PostingLinkError(
    "isn't a TikTok or Instagram link. Paste the post's link, e.g. https://www.tiktok.com/@name/video/123.",
  );

  if (/\s/.test(value)) {
    if (/(?:tiktok|instagram)\.com/i.test(value)) {
      throw new PostingLinkError('has a space in it. Paste just the link.');
    }
    throw notALink;
  }

  if (!HAS_SCHEME.test(value)) {
    if (!KNOWN_HOST_WITHOUT_SCHEME.test(value)) throw notALink;
    value = `https://${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PostingLinkError("isn't a valid link. Check it for typos.");
  }

  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') {
    throw new PostingLinkError("isn't a web link. It should start with https://.");
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (TIKTOK_HOSTS.includes(host)) {
    const isShortLink = host.startsWith('vm.') || host.startsWith('vt.') ? path.length > 1 : TIKTOK_SHORT_PATH.test(path);
    if (!isShortLink && !TIKTOK_POST_PATH.test(path)) {
      throw new PostingLinkError(
        "is a TikTok link but not to a post. Open the video and copy its link (it has /video/ in it).",
      );
    }
  } else if (INSTAGRAM_HOSTS.includes(host)) {
    if (!INSTAGRAM_POST_PATH.test(path)) {
      throw new PostingLinkError(
        'is an Instagram link but not to a post. Open the post or reel and copy its link (it has /p/ or /reel/ in it).',
      );
    }
  } else {
    throw new PostingLinkError(`is from ${host}. Only TikTok and Instagram links are accepted.`);
  }

  return url.toString();
}

const postKey = (link: string) => {
  const url = new URL(link);
  return `${url.hostname.replace(/^(?:www|m)\./, '')}${url.pathname.replace(/\/$/, '')}`;
};

/**
 * Normalises a submission's posting links: blanks dropped, each one validated (see
 * normalizePostingLink), duplicates and too many links rejected. Error messages name the
 * link by its position when there's more than one.
 */
export function normalizePostingLinks(rawLinks: string[]): string[] {
  if (!Array.isArray(rawLinks)) {
    throw new PostingLinkError('postingLinks must be an array');
  }

  const links = rawLinks.map((link) => String(link ?? '').trim()).filter((link) => link.length > 0);

  if (links.length === 0) {
    throw new PostingLinkError('Add at least one posting link.');
  }

  if (links.length > MAX_POSTING_LINKS) {
    throw new PostingLinkError(`A submission can have at most ${MAX_POSTING_LINKS} posting links.`);
  }

  const name = (index: number) => (links.length > 1 ? `Link ${index + 1}` : 'The link');
  const seen = new Map<string, number>();

  return links.map((link, index) => {
    let normalized: string;
    try {
      normalized = normalizePostingLink(link);
    } catch (error) {
      if (error instanceof PostingLinkError) throw new PostingLinkError(`${name(index)} ${error.message}`);
      throw error;
    }

    const key = postKey(normalized);
    if (seen.has(key)) {
      throw new PostingLinkError(`Link ${index + 1} is the same post as link ${(seen.get(key) as number) + 1}.`);
    }
    seen.set(key, index);

    return normalized;
  });
}

export const joinPostingLinksToContent = (links: string[]): string => links.join('\n');
