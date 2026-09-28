import { calculateAge } from '@utils/calculateAge';
import { mapPronounsToGender } from '@utils/mapPronounsToGender';
import { metricNumber } from '@services/creatorDiscoveryProfileService';
import { normalizeProfileUrl } from '@services/guestProfileExtraction/profileUrlNormalizer';
import { extractHashtags, normalizeKeywordTerm, matchesContentTerms, PlatformFilter } from './queryHelpers';
import { buildConnectedSelect } from './queryBuilders';

const platforms = ['instagram', 'tiktok'] as const;

export const savedDiscoveryProfilesEnabled = () => process.env.DISCOVERY_SAVED_PROFILES_ENABLED !== 'false';

export function buildDiscoverySelect(full = false, contentSearch = false, accessToken = false) {
  const select: any = buildConnectedSelect(accessToken);
  select.status = true;
  select.createdAt = true;
  Object.assign(select.creator.select, {
    isGuest: true,
    profileLink: true,
    instagramProfileLink: true,
    tiktokProfileLink: true,
    discoveryProfiles: {
      select: {
        platform: true,
        biography: true,
        profileUrl: true,
        handle: true,
        followers: true,
        engagementRate: true,
        followersSource: true,
        engagementRateSource: true,
        savedAt: true,
        scrapedAt: true,
        createdAt: true,
        linkedAt: true,
        ...(full ? { scrapeDetails: true } : {}),
        ...(contentSearch ? { captions: true } : {}),
      },
    },
  });
  if (!savedDiscoveryProfilesEnabled()) delete select.creator.select.discoveryProfiles;
  if (!full) {
    delete select.creator.select.instagramUser.select.insightData;
    for (const platform of platforms) {
      const account = select.creator.select[`${platform}User`].select;
      delete account[`${platform}Video`];
      if (contentSearch)
        account[`${platform}Video`] = { select: { [platform === 'instagram' ? 'caption' : 'title']: true } };
    }
  }
  return select;
}

export function recordedAverage(posts: any[], field: string): number | null {
  const values = posts.map((post) => metricNumber(post?.[field])).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function platformData(creator: any, platform: 'instagram' | 'tiktok') {
  const connected = Boolean(
    creator?.[platform === 'instagram' ? 'isFacebookConnected' : 'isTiktokConnected'] && creator?.[`${platform}User`],
  );
  const account = connected ? creator[`${platform}User`] : null;
  const saved = creator?.discoveryProfiles?.find((profile: any) => profile.platform === platform);
  const rawHandle = account?.username || creator?.[platform];
  const normalizedHandle = rawHandle
    ? normalizeProfileUrl(
        /^https?:/.test(rawHandle)
          ? rawHandle
          : platform === 'instagram'
            ? `https://www.instagram.com/${rawHandle.replace(/^@/, '')}`
            : `https://www.tiktok.com/@${rawHandle.replace(/^@/, '')}`,
      )
    : null;
  const connectedHandle =
    normalizedHandle?.ok && normalizedHandle.profile.platform === platform ? normalizedHandle.profile.username : null;
  const handle = (connected ? connectedHandle : null) ?? saved?.handle ?? connectedHandle ?? null;
  const rawLink = creator?.[`${platform}ProfileLink`] ?? creator?.profileLink;
  const normalizedLink = normalizeProfileUrl(rawLink ?? '');
  const profileUrl =
    (connected && connectedHandle ? normalizedHandle?.ok && normalizedHandle.profile.canonicalUrl : null) ||
    saved?.profileUrl ||
    (normalizedLink.ok && normalizedLink.profile.platform === platform ? normalizedLink.profile.canonicalUrl : null) ||
    (handle
      ? platform === 'instagram'
        ? `https://www.instagram.com/${handle}`
        : `https://www.tiktok.com/@${handle}`
      : null);
  const connectedFollowers = metricNumber(account?.[platform === 'instagram' ? 'followers_count' : 'follower_count']);
  const connectedRate = metricNumber(account?.engagement_rate);
  const metricSources = {
    followers:
      connectedFollowers != null
        ? 'connected'
        : saved?.followers != null
          ? (saved.followersSource ?? 'master_list')
          : null,
    engagementRate:
      connectedRate != null
        ? 'connected'
        : saved?.engagementRate != null
          ? (saved.engagementRateSource ?? 'master_list')
          : null,
  };
  const sources = [...new Set(Object.values(metricSources).filter(Boolean))];
  const posts = saved?.scrapeDetails?.selectedPosts ?? [];
  const savedVideos = posts.map((post: any) => ({
    ...post,
    id: post.postId,
    savedPost: true,
    thumbnail_url: post.thumbnailUrl ?? null,
    cover_image_url: post.thumbnailUrl ?? null,
    video_id: post.postId,
    caption: post.caption,
    title: post.caption,
    permalink: post.postUrl,
    video_url: post.postUrl,
    like_count: post.likes,
    comments_count: post.comments,
    comment_count: post.comments,
    share_count: post.shares,
    save_count: post.saves,
    view_count: post.views,
    datePosted: post.publishedAt,
    createdAt: post.publishedAt,
  }));
  const connectedVideos = (account?.[`${platform}Video`] ?? []).map((video: any) => ({
    ...video,
    ...(platform === 'tiktok' && handle && video.video_id
      ? { video_url: `https://www.tiktok.com/@${handle}/video/${video.video_id}` }
      : {}),
  }));
  return {
    connected,
    available: connected || Boolean(saved),
    handle,
    profileUrl,
    followers: connectedFollowers ?? metricNumber(saved?.followers),
    engagementRate: connectedRate ?? metricNumber(saved?.engagementRate),
    metricSources,
    metricSource: sources.length > 1 ? (sources.includes('connected') ? 'mixed' : 'master_list') : (sources[0] ?? null),
    savedAt: saved?.savedAt ?? null,
    scrapedAt: saved?.scrapedAt ?? null,
    scrapeDetails: saved?.scrapeDetails ?? null,
    profilePictureUrl: account?.profile_picture_url ?? account?.avatar_url ?? null,
    biography: account?.biography?.trim() || saved?.biography || null,
    insightData: account?.insightData ?? null,
    totalLikes: metricNumber(account?.totalLikes),
    totalSaves: metricNumber(account?.totalSaves),
    totalShares: metricNumber(account?.totalShares),
    averageLikes: metricNumber(account?.averageLikes) ?? recordedAverage(posts, 'likes'),
    averageComments: metricNumber(account?.averageComments) ?? recordedAverage(posts, 'comments'),
    averageViews: recordedAverage(posts, 'views'),
    averageSaves: metricNumber(account?.averageSaves) ?? recordedAverage(posts, 'saves'),
    averageShares: metricNumber(account?.averageShares) ?? recordedAverage(posts, 'shares'),
    topVideos: connectedVideos.length ? connectedVideos : savedVideos,
    searchCaptions: [saved?.captions, ...connectedVideos.map((video: any) => video.caption ?? video.title)]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * When the row joined Discovery: account creation, the first save of its
 * scrape, or a later Link Creator. A re-scrape does not move it.
 */
function addedAt(user: any, platform: 'instagram' | 'tiktok'): Date | null {
  const saved = user.creator?.discoveryProfiles?.find((profile: any) => profile.platform === platform);
  const times = [user.createdAt, saved?.createdAt, saved?.linkedAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

export function mapDiscoveryRows(users: any[], platform: PlatformFilter): any[] {
  return users.flatMap((user) => {
    const creator = user.creator;
    const instagram = platformData(creator, 'instagram');
    const tiktok = platformData(creator, 'tiktok');
    const base = {
      type: creator?.isGuest || user.status === 'guest' ? 'non-platform' : 'connected',
      isGuest: Boolean(creator?.isGuest || user.status === 'guest'),
      userId: user.id,
      creatorId: creator?.id,
      name: user.name,
      age: calculateAge(creator?.birthDate),
      gender: mapPronounsToGender(creator?.pronounce),
      location: [user.city?.trim(), user.country?.trim()].filter(Boolean).join(', ') || null,
      creditTier: creator?.creditTier?.name ?? null,
      handles: { instagram: instagram.handle, tiktok: tiktok.handle },
      interests: creator?.interests?.map((interest: any) => interest.name).filter(Boolean) ?? [],
      languages: Array.isArray(creator?.languages) ? creator.languages : [],
      about: creator?.mediaKit?.about ?? null,
      instagram,
      tiktok,
    };
    return platforms
      .filter((key) => (platform === 'all' || key === platform) && base[key].available)
      .map((key) => ({ ...base, platform: key, rowId: `${user.id}-${key}`, addedAt: addedAt(user, key) }));
  });
}

export function matchesDiscoveryRow(row: any, input: { search?: string; keyword?: string; hashtag?: string }) {
  const data = row[row.platform];
  const identity = [row.name, data.handle, row.about].filter(Boolean).join(' ').toLowerCase();
  if (input.search?.trim() && !identity.includes(input.search.trim().toLowerCase())) return false;
  return matchesContentTerms([data.biography, data.searchCaptions].filter(Boolean), {
    keywordTerm: normalizeKeywordTerm(input.keyword) || undefined,
    hashtagTerms: extractHashtags(input.hashtag),
    keywordOnlyTexts: [identity, ...row.interests],
  });
}
