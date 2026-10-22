jest.mock('../src/prisma/prisma', () => ({
  prisma: { submissionPostingUrl: { findMany: jest.fn() } },
}));
jest.mock('../src/service/submissionUrlService', () => ({ extractAndStoreSubmissionUrls: jest.fn() }));
jest.mock('../src/service/postMetricsScrape/queuePostScrape', () => ({ queuePostScrape: jest.fn() }));

import { prisma } from '../src/prisma/prisma';
import { queuePostScrape } from '../src/service/postMetricsScrape/queuePostScrape';
import { queueDailyPostScrapes } from '../src/service/postMetricsScrape/dailyPostScrapes';
import { scrapePostMetrics } from '../src/service/postMetricsScrape/postMetricsScrapeService';
import { isInScrapeWindow } from '../src/service/postMetricsScrape/scrapeDay';

const db = prisma as any;

// Campaign period 1-30 October, link approved 14 October (all Malaysia time).
const approvedAt = new Date('2026-10-14T06:00:00Z');
const campaignEnd = new Date('2026-10-29T16:00:00Z');
const myt = (iso: string) => new Date(`${iso}+08:00`);

describe('isInScrapeWindow', () => {
  it('scrapes from the approval day to the last campaign day', () => {
    expect(isInScrapeWindow(approvedAt, campaignEnd, myt('2026-10-13T23:59:00'))).toBe(false);
    expect(isInScrapeWindow(approvedAt, campaignEnd, myt('2026-10-14T00:00:00'))).toBe(true);
    expect(isInScrapeWindow(approvedAt, campaignEnd, myt('2026-10-30T00:00:00'))).toBe(true);
    expect(isInScrapeWindow(approvedAt, campaignEnd, myt('2026-10-31T00:00:00'))).toBe(false);
  });

  it('never scrapes without a posting date or campaign end', () => {
    expect(isInScrapeWindow(null, campaignEnd, myt('2026-10-20T00:00:00'))).toBe(false);
    expect(isInScrapeWindow(approvedAt, null, myt('2026-10-20T00:00:00'))).toBe(false);
  });
});

describe('queueDailyPostScrapes', () => {
  const creator = (tiktokConnected: boolean) => ({
    isFacebookConnected: false,
    isTiktokConnected: tiktokConnected,
    instagramUser: null,
    tiktokUser: tiktokConnected ? { id: 'tt-1' } : null,
  });
  const row = (id: string, overrides: { endDate?: Date; connected?: boolean } = {}) => ({
    id,
    campaignId: 'camp-1',
    submissionId: `sub-${id}`,
    platform: 'TikTok',
    postingDate: approvedAt,
    campaign: { campaignBrief: { endDate: overrides.endDate ?? campaignEnd } },
    submission: { user: { creator: creator(overrides.connected ?? false) } },
  });

  it('queues only unconnected links inside their campaign period', async () => {
    db.submissionPostingUrl.findMany.mockResolvedValue([
      row('due'),
      row('connected', { connected: true }),
      row('ended', { endDate: new Date('2026-10-19T16:00:00Z') }),
    ]);

    const result = await queueDailyPostScrapes(myt('2026-10-21T00:00:00'));

    expect(result).toEqual({ evaluated: 3, queued: 1 });
    expect(queuePostScrape).toHaveBeenCalledTimes(1);
    expect(queuePostScrape).toHaveBeenCalledWith({
      postingUrlId: 'due',
      campaignId: 'camp-1',
      submissionId: 'sub-due',
    });
  });
});

describe('scrapePostMetrics daily claim', () => {
  const lastScrape = myt('2026-10-20T00:05:00');
  const now = myt('2026-10-21T00:01:00');

  const deps = () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    return {
      updateMany,
      deps: {
        store: {
          submissionPostingUrl: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'url-1',
              campaignId: 'camp-1',
              submissionId: 'sub-1',
              platform: 'TikTok',
              postUrl: 'https://www.tiktok.com/@someone/video/123',
              postingDate: approvedAt,
              shortCode: null,
              mediaId: '123',
              metricsScrapedAt: lastScrape,
              submission: { userId: 'user-1', status: 'POSTED', content: 'https://www.tiktok.com/@someone/video/123' },
            }),
            updateMany,
          },
          dailyPostEngagementSnapshot: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
        },
        gateway: {
          startJob: jest.fn().mockResolvedValue({ ok: false, ambiguous: false, code: 'REFUSED', message: 'no' }),
        } as any,
        pollTimeoutMs: 1000,
        discoveryPollTimeoutMs: 1000,
        now: () => now,
      },
    };
  };

  it('claims a link scraped on an earlier day, and gives back the claim when nothing was billed', async () => {
    const { deps: d, updateMany } = deps();

    const outcome = await scrapePostMetrics('url-1', d);

    expect(outcome).toBe('START_REFUSED');
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'url-1',
        OR: [{ metricsScrapedAt: null }, { metricsScrapedAt: { lt: myt('2026-10-21T00:00:00') } }],
      },
      data: { metricsScrapedAt: now, metricsScrapeStatus: 'RUNNING' },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'url-1' },
      data: { metricsScrapedAt: lastScrape },
    });
  });
});
