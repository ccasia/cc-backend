import { PlatformFilter } from '@helper/discovery/queryHelpers';

export type DiscoverySortBy = 'name' | 'followers';
export type DiscoverySortDirection = 'asc' | 'desc';

export const normalizeDiscoverySort = (
  sortBy?: string,
  sortDirection?: string,
): { sortBy: DiscoverySortBy; sortDirection: DiscoverySortDirection } => {
  const normalizedSortBy: DiscoverySortBy = sortBy === 'followers' ? 'followers' : 'name';

  if (normalizedSortBy === 'followers') {
    return {
      sortBy: normalizedSortBy,
      sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
    };
  }

  return {
    sortBy: normalizedSortBy,
    sortDirection: sortDirection === 'desc' ? 'desc' : 'asc',
  };
};

export const buildDiscoveryUserOrderBy = (
  platform: PlatformFilter,
  sortBy: DiscoverySortBy,
  sortDirection: DiscoverySortDirection,
) => {
  if (sortBy === 'followers') {
    if (platform === 'instagram') {
      return [
        {
          creator: {
            instagramUser: {
              followers_count: sortDirection,
            },
          },
        },
        { name: 'asc' as const },
      ];
    }

    if (platform === 'tiktok') {
      return [
        {
          creator: {
            tiktokUser: {
              follower_count: sortDirection,
            },
          },
        },
        { name: 'asc' as const },
      ];
    }
  }

  return [
    { name: sortDirection },
    { updatedAt: 'desc' as const },
  ];
};

const getCreatorFollowersForSort = (creator: any) => {
  if (creator?.platform === 'instagram') {
    return Number(creator?.instagram?.followers || 0);
  }

  if (creator?.platform === 'tiktok') {
    return Number(creator?.tiktok?.followers || 0);
  }

  const instagramFollowers = Number(creator?.instagram?.followers || 0);
  const tiktokFollowers = Number(creator?.tiktok?.followers || 0);
  return Math.max(instagramFollowers, tiktokFollowers);
};

export const sortDiscoveryRows = (
  rows: any[],
  sortBy: DiscoverySortBy,
  sortDirection: DiscoverySortDirection,
) => {
  const rowsCopy = [...(rows || [])];

  rowsCopy.sort((left, right) => {
    if (sortBy === 'followers') {
      const leftFollowers = getCreatorFollowersForSort(left);
      const rightFollowers = getCreatorFollowersForSort(right);
      if (leftFollowers !== rightFollowers) {
        return sortDirection === 'asc' ? leftFollowers - rightFollowers : rightFollowers - leftFollowers;
      }
    }

    const leftName = String(left?.name || '').toLocaleLowerCase();
    const rightName = String(right?.name || '').toLocaleLowerCase();

    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
    return 0;
  });

  return rowsCopy;
};
