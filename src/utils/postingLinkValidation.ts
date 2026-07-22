export const MAX_POSTING_LINKS = 2;

export function normalizePostingLinks(rawLinks: string[]): string[] {
  if (!Array.isArray(rawLinks)) {
    throw new Error('postingLinks must be an array');
  }

  const trimmed = rawLinks.map((link) => link.trim()).filter((link) => link.length > 0);

  if (trimmed.length === 0) {
    throw new Error('At least one posting link is required');
  }

  if (trimmed.length > MAX_POSTING_LINKS) {
    throw new Error(`Maximum ${MAX_POSTING_LINKS} posting links allowed`);
  }

  const seen = new Set<string>();
  for (const link of trimmed) {
    try {
      // eslint-disable-next-line no-new
      new URL(link);
    } catch {
      throw new Error(`Invalid posting link URL: ${link}`);
    }

    if (seen.has(link)) {
      throw new Error(`Duplicate posting link: ${link}`);
    }
    seen.add(link);
  }

  return trimmed;
}

export const joinPostingLinksToContent = (links: string[]): string => links.join('\n');
