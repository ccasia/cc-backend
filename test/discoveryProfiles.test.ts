import { discoveryProfileUpdate } from '../src/service/creatorDiscoveryProfileService';

const audit = {
  guestUserId: 'u1',
  platform: 'tiktok',
  canonicalProfileKey: 'tiktok:telvinator',
  finalFollowerCount: 0,
  finalEngagementRate: '24.39',
  source: 'automatic',
  createdAt: new Date('2026-09-01T00:00:00Z'),
};

test('saved metrics preserve zero and normalize a matching platform link', () => {
  expect(discoveryProfileUpdate(audit)).toMatchObject({
    userId: 'u1',
    platform: 'tiktok',
    profileUrl: 'https://www.tiktok.com/@telvinator',
    followers: 0,
    engagementRate: 24.39,
  });
});

test('failed scrape has no update', () => {
  expect(
    discoveryProfileUpdate({ ...audit, source: 'unavailable', finalFollowerCount: null, finalEngagementRate: null }),
  ).toBeNull();
});

test('manual override does not invent scrape evidence', () => {
  const update = discoveryProfileUpdate({ ...audit, source: 'manual_override', finalEngagementRate: '0' });
  expect(update).toMatchObject({ engagementRate: 0 });
  expect(update?.scrapeDetails).toBeUndefined();
});

test('copies scrape evidence independent of overridden metrics and temporary row', () => {
  const extraction = {
    status: 'READY',
    resultEngagementRate: '7.55',
    resultFollowerCount: 100,
    selectedPosts: [{ postId: 'p', caption: '#test', likes: 0, views: 10 }],
    candidatePosts: [{ postId: 'excluded', usedInSample: false }],
    completedAt: new Date('2026-08-31'),
    formulaVersion: 'instagram_recent_10_median_view_v2',
  };
  const update = discoveryProfileUpdate({ ...audit, source: 'manual_override' }, extraction);
  expect(update?.scrapeDetails).toMatchObject({
    engagementRate: 7.55,
    selectedPosts: extraction.selectedPosts,
    candidatePosts: extraction.candidatePosts,
    formulaVersion: extraction.formulaVersion,
  });
  expect(update?.engagementRate).toBe(24.39);
});

test('saves manual followers when the audit marks engagement rate unavailable', () => {
  expect(
    discoveryProfileUpdate({ ...audit, source: 'unavailable', finalFollowerCount: 150, finalEngagementRate: null }),
  ).toMatchObject({ followers: 150, engagementRate: null, source: 'manual_override' });
});
