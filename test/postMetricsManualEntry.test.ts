import {
  enterMetricsByHand,
  keepKnownCounts,
  type PostScrapeStore,
} from '@services/postMetricsScrape/postMetricsScrapeService';

const counts = { views: 1000, likes: 80, comments: 5, shares: 0, saved: 0 };

const fakeStore = (status: string | null, last: Record<string, unknown> | null) => {
  const upserts: any[] = [];
  const store = {
    submissionPostingUrl: {
      findUnique: async () => ({
        id: 'pu1',
        campaignId: 'c1',
        submissionId: 's1',
        platform: 'Instagram',
        postUrl: 'https://www.instagram.com/reel/abc/',
        postingDate: new Date('2026-11-01'),
        shortCode: 'abc',
        mediaId: null,
        metricsScrapeStatus: status,
        metricsScrapeFailure: status === 'FAILED' ? { partial: null } : null,
        submission: { userId: 'u1', status: 'POSTED', content: 'https://www.instagram.com/reel/abc/' },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    dailyPostEngagementSnapshot: {
      findUnique: async () => null,
      findFirst: async () => last,
      upsert: async (args: unknown) => {
        upserts.push(args);
      },
    },
  };
  return { store: store as unknown as PostScrapeStore, upserts };
};

const enter = (store: PostScrapeStore, metrics: Record<string, number>) =>
  enterMetricsByHand(store, { campaignId: 'c1', postingUrlId: 'pu1', metrics, adminId: 'admin1' });

describe('keepKnownCounts', () => {
  it('keeps a count the scrape read as 0, and takes every count it did read', () => {
    expect(keepKnownCounts({ ...counts, likes: 90 }, { ...counts, shares: 12, saved: 7 })).toEqual({
      ...counts,
      likes: 90,
      shares: 12,
      saved: 7,
    });
    expect(keepKnownCounts(counts, null)).toEqual(counts);
  });
});

describe('enterMetricsByHand', () => {
  it('fills Instagram shares and saves on a scraped post and keeps the rest', async () => {
    const { store, upserts } = fakeStore('SCRAPED', {
      ...counts,
      source: 'brightdata',
      rawMetrics: { item: { caption: 'hi' } },
    });
    const result = await enter(store, { shares: 12, saved: 7 });

    expect(result).toEqual({ ok: true, metrics: { ...counts, shares: 12, saved: 7 } });
    const { update } = upserts[0];
    expect(update.engagementRate).toBeCloseTo(10.4); // (80 + 5 + 12 + 7) / 1000
    expect(update.rawMetrics.item).toEqual({ caption: 'hi' });
    expect(update.rawMetrics.manual.entered).toEqual({ shares: 12, saved: 7 });
  });

  it('never replaces numbers from a connected account', async () => {
    const { store, upserts } = fakeStore('SCRAPED', { ...counts, source: 'api', rawMetrics: {} });
    expect(await enter(store, { shares: 12 })).toMatchObject({ ok: false, status: 409 });
    expect(upserts).toHaveLength(0);
  });

  it('still needs views, likes and comments for a failed scrape', async () => {
    const { store } = fakeStore('FAILED', null);
    expect(await enter(store, { shares: 3 })).toMatchObject({ ok: false, status: 400 });
    expect(await enter(store, { views: 500, likes: 20, comments: 1 })).toMatchObject({ ok: true });
  });
});
