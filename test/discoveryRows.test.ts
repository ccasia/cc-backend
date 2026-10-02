import { mapDiscoveryRows, matchesDiscoveryRow } from '../src/helper/discovery/savedProfiles';
import { sortDiscoveryRows } from '../src/helper/discovery/sortHelpers';

const user = {
  id: 'u',
  name: 'Guest',
  creator: {
    id: 'c',
    isGuest: true,
    discoveryProfiles: [
      {
        platform: 'instagram',
        handle: 'ig',
        profileUrl: 'https://www.instagram.com/ig',
        followers: 0,
        engagementRate: 7.55,
        followersSource: 'manual_override',
      },
      {
        platform: 'tiktok',
        handle: 'tt',
        profileUrl: 'https://www.tiktok.com/@tt',
        followers: 12000,
        engagementRate: 24.39,
        captions: '#gaming win',
      },
    ],
  },
};

test('emits one row for each saved platform without claiming a connection', () => {
  const rows = mapDiscoveryRows([user], 'all');
  expect(rows.map((r) => r.rowId)).toEqual(['u-instagram', 'u-tiktok']);
  expect(rows[1]).toMatchObject({
    isGuest: true,
    tiktok: { connected: false, available: true, engagementRate: 24.39, profileUrl: 'https://www.tiktok.com/@tt' },
  });
  expect(rows[0].instagram.followers).toBe(0);
});

test('connected values win per metric, including zero; missing values use saved metrics', () => {
  const [row] = mapDiscoveryRows(
    [
      {
        ...user,
        creator: {
          ...user.creator,
          isFacebookConnected: true,
          instagramUser: { followers_count: 0, engagement_rate: null },
        },
      },
    ],
    'instagram',
  );
  expect(row.instagram).toMatchObject({
    connected: true,
    followers: 0,
    engagementRate: 7.55,
    metricSources: { followers: 'connected', engagementRate: 'master_list' },
  });
});

test('unknown metrics stay null and averages exclude unreported counters', () => {
  const [row] = mapDiscoveryRows(
    [
      {
        id: 'x',
        creator: {
          discoveryProfiles: [
            {
              platform: 'instagram',
              scrapeDetails: { selectedPosts: [{ likes: 0, saves: null }, { likes: 10 }, { likes: null }] },
            },
          ],
        },
      },
    ],
    'all',
  );
  expect(row.instagram.followers).toBeNull();
  expect(row.instagram.averageLikes).toBe(5);
  expect(row.instagram.averageSaves).toBeNull();
});

test('searches only the matching platform handle and captions', () => {
  const rows = mapDiscoveryRows([user], 'all');
  expect(
    rows.filter((r) => matchesDiscoveryRow(r, { keyword: 'gaming', hashtag: '#gaming' })).map((r) => r.platform),
  ).toEqual(['tiktok']);
  expect(rows.filter((r) => matchesDiscoveryRow(r, { search: 'tt' })).map((r) => r.platform)).toEqual(['tiktok']);
});

test('sorts platform rows before selecting a page and honors name direction', () => {
  const rows = mapDiscoveryRows([user, { ...user, id: 'a', name: 'Alpha' }], 'all');
  expect(
    sortDiscoveryRows(rows, 'followers', 'desc')
      .slice(0, 2)
      .map((r) => r.platform),
  ).toEqual(['tiktok', 'tiktok']);
  expect(sortDiscoveryRows(rows, 'name', 'desc')[0].name).toBe('Guest');
});
