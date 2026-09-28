import { computeEngagementRate } from '../src/service/guestProfileExtraction/engagementRateCalculator';
import { parseInstagramActorOutput } from '../src/service/guestProfileExtraction/actorAdapters/instagramActorAdapter';
import { parseTiktokActorOutput } from '../src/service/guestProfileExtraction/actorAdapters/tiktokActorAdapter';
import { applyValidPostPolicy } from '../src/service/guestProfileExtraction/validPostPolicy';
import { mapDiscoveryRows } from '../src/helper/discovery/savedProfiles';

const image = 'https://images.example.com/post.jpg';
test('Instagram adapter keeps the existing dataset thumbnail', () => {
  const output = parseInstagramActorOutput({
    expectedUsername: 'owner',
    items: [{ id: '1', ownerUsername: 'owner', displayUrl: image }],
  });
  expect(output.ok && output.candidates[0]).toMatchObject({ thumbnailUrl: image });
});
test('TikTok adapter keeps the cover from the existing dataset', () => {
  const output = parseTiktokActorOutput({
    expectedUsername: 'owner',
    items: [{ id: '1', authorMeta: { name: 'owner' }, videoMeta: { coverUrl: image } }],
  });
  expect(output.ok && output.candidates[0]).toMatchObject({ thumbnailUrl: image });
});
test('Discovery exposes saved images on both platforms and retains missing-image placeholders', () => {
  for (const platform of ['instagram', 'tiktok'] as const) {
    const [row] = mapDiscoveryRows(
      [
        {
          id: 'u',
          creator: {
            discoveryProfiles: [
              { platform, scrapeDetails: { selectedPosts: [{ postId: '1', thumbnailUrl: image }, { postId: '2' }] } },
            ],
          },
        },
      ],
      'all',
    );
    expect(row[platform].topVideos[0]).toMatchObject({ thumbnail_url: image, cover_image_url: image });
    expect(row[platform].topVideos[1].thumbnail_url).toBeNull();
  }
});

test('post selection and formula evidence keep thumbnail URLs without changing metrics', () => {
  const output = parseInstagramActorOutput({
    expectedUsername: 'owner',
    items: Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      ownerUsername: 'owner',
      displayUrl: image,
      timestamp: '2026-09-01',
      likesCount: 5,
      commentsCount: 5,
      videoPlayCount: 100,
      isPinned: false,
      paidPartnership: false,
    })),
  });
  if (!output.ok) throw new Error('Fixture must parse');
  const policy = applyValidPostPolicy(output.candidates, { ownerHandle: 'owner', now: new Date('2026-09-02') });
  const rate = computeEngagementRate({ platform: 'instagram', posts: policy.valid, followerCount: 1000 });
  expect(rate.ok && rate.evidence[0].thumbnailUrl).toBe(image);
  expect(rate.ok && rate.engagementRatePercent).toBe(10);
});

test('reads Instagram biography and TikTok signature from profile results', () => {
  const instagram = parseInstagramActorOutput({
    expectedUsername: 'owner',
    items: [{ id: '1', ownerUsername: 'owner' }],
    profileItems: [{ username: 'owner', biography: 'Instagram bio' }],
  });
  const tiktok = parseTiktokActorOutput({
    expectedUsername: 'owner',
    items: [{ id: '1', authorMeta: { name: 'owner', signature: 'TikTok bio' } }],
  });
  expect(instagram.ok && instagram.profile).toMatchObject({ biography: 'Instagram bio' });
  expect(tiktok.ok && tiktok.profile).toMatchObject({ biography: 'TikTok bio' });
});

test('uses saved platform biography when the connected account has none', () => {
  const [row] = mapDiscoveryRows(
    [
      {
        id: 'u',
        creator: {
          isFacebookConnected: true,
          instagramUser: { biography: null },
          discoveryProfiles: [{ platform: 'instagram', biography: 'Saved profile bio' }],
        },
      },
    ],
    'instagram',
  );
  expect(row.instagram.biography).toBe('Saved profile bio');
});
