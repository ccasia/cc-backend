/**
 * Fill Creator.instagramProfileLink / tiktokProfileLink from a scrape.
 *
 * Additive. An existing link on that platform is left alone. The other
 * platform is never touched. This is a pasted/scraped URL, not a connected
 * InstagramUser / TiktokUser row.
 */

const isBlank = (value: unknown): boolean =>
  value == null || (typeof value === 'string' && value.trim() === '');

export type ProfileLinkPatch = {
  instagramProfileLink?: string;
  tiktokProfileLink?: string;
};

export function scrapedProfileLinkPatch(
  current: {
    instagramProfileLink?: string | null;
    tiktokProfileLink?: string | null;
  } | null,
  platform: string | null | undefined,
  url: string | null | undefined,
): ProfileLinkPatch {
  if (!url || typeof url !== 'string' || !url.trim()) return {};
  const trimmed = url.trim();

  if (platform === 'instagram' && isBlank(current?.instagramProfileLink)) {
    return { instagramProfileLink: trimmed };
  }
  if (platform === 'tiktok' && isBlank(current?.tiktokProfileLink)) {
    return { tiktokProfileLink: trimmed };
  }
  return {};
}

type CreatorLinkClient = {
  creator: {
    findUnique(args: { where: { userId: string }; select?: unknown }): Promise<{
      instagramProfileLink?: string | null;
      tiktokProfileLink?: string | null;
    } | null>;
    update(args: { where: { userId: string }; data: ProfileLinkPatch }): Promise<unknown>;
  };
};

export async function ensureScrapedProfileLink(
  tx: CreatorLinkClient,
  userId: string,
  platform: string | null | undefined,
  url: string | null | undefined,
): Promise<void> {
  const current = await tx.creator.findUnique({
    where: { userId },
    select: { instagramProfileLink: true, tiktokProfileLink: true },
  });
  if (!current) return;

  const patch = scrapedProfileLinkPatch(current, platform, url);
  if (!patch.instagramProfileLink && !patch.tiktokProfileLink) return;

  await tx.creator.update({ where: { userId }, data: patch });
}
