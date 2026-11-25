import { SCRAPERS, type ExtractionConfig } from '../src/config/guestProfileExtractionConfig';
import type { ScraperGateway } from '../src/service/guestProfileExtraction/brightDataGateway';
import {
  parsePrimaryMetric,
  parseRecentViews,
  validateManualGuests,
  validateSubmittedGuests,
} from '../src/service/guestProfileExtraction/guestCreateService';
import { classifyMetricProvenance } from '../src/service/guestProfileExtraction/metricProvenance';
import {
  processExtraction,
  startExtraction,
  type ExtractionDeps,
} from '../src/service/guestProfileExtraction/guestProfileExtractionService';
import { normalizeProfileUrl } from '../src/service/guestProfileExtraction/profileUrlNormalizer';

describe('Threads profile URL normalization', () => {
  it.each([
    'https://www.threads.com/@Panda.Pandiy_',
    'threads.com/@panda.pandiy_',
    'https://threads.net/@panda.pandiy_/',
    'https://www.threads.net/@panda.pandiy_?igshid=1#top',
  ])('canonicalizes %s', (link) => {
    const result = normalizeProfileUrl(link);
    expect(result).toEqual({
      ok: true,
      profile: {
        platform: 'threads',
        username: 'panda.pandiy_',
        canonicalUrl: 'https://www.threads.com/@panda.pandiy_',
        canonicalKey: 'threads:panda.pandiy_',
      },
    });
  });

  it('requires the @ before the name', () => {
    const result = normalizeProfileUrl('https://www.threads.com/pandapandiy_');
    expect(result).toMatchObject({ ok: false, code: 'NOT_A_PROFILE_URL' });
    expect(result.ok === false && result.message).toContain('Threads');
  });

  it.each(['search', 'activity', 'login', 'settings', 't', 'post', 'intent', 'api'])(
    'rejects the reserved path @%s',
    (word) => {
      expect(normalizeProfileUrl(`https://www.threads.com/@${word}`)).toMatchObject({
        ok: false,
        code: 'NOT_A_PROFILE_URL',
      });
    },
  );

  it('rejects a post link and a bad name', () => {
    expect(normalizeProfileUrl('https://www.threads.com/@user/post/abc')).toMatchObject({
      ok: false,
      code: 'NOT_A_PROFILE_URL',
    });
    expect(normalizeProfileUrl('https://www.threads.com/@bad..name')).toMatchObject({
      ok: false,
      code: 'INVALID_USERNAME',
    });
    expect(normalizeProfileUrl(`https://www.threads.com/@${'a'.repeat(31)}`)).toMatchObject({
      ok: false,
      code: 'INVALID_USERNAME',
    });
  });

  it('names Threads in the unsupported host message', () => {
    expect(normalizeProfileUrl('https://youtube.com/@someone')).toEqual({
      ok: false,
      code: 'UNSUPPORTED_HOST',
      message: 'Use an Instagram, TikTok, or Threads profile link.',
    });
  });

  it('keeps Instagram and TikTok output unchanged', () => {
    expect(normalizeProfileUrl('instagram.com/Example')).toMatchObject({
      ok: true,
      profile: { canonicalUrl: 'https://www.instagram.com/example', canonicalKey: 'instagram:example' },
    });
    expect(normalizeProfileUrl('https://tiktok.com/@Example')).toMatchObject({
      ok: true,
      profile: { canonicalUrl: 'https://www.tiktok.com/@example', canonicalKey: 'tiktok:example' },
    });
    expect(normalizeProfileUrl('https://www.tiktok.com/example')).toMatchObject({
      ok: false,
      message: 'A TikTok profile link contains @ before the name.',
    });
  });
});

describe('parseRecentViews', () => {
  it.each([
    ['1300000', '1300000'],
    ['1,300,000', '1300000'],
    ['1.3M', '1300000'],
    ['1.3m', '1300000'],
    ['850k', '850000'],
    ['850K', '850000'],
    ['2B', '2000000000'],
    ['1.3M recent views', '1300000'],
    ['1.3M Recent Views', '1300000'],
    ['12,400 views', '12400'],
    ['  42  ', '42'],
    ['0', '0'],
    [1300000, '1300000'],
    [0, '0'],
  ])('reads %p as %p', (input, expected) => {
    expect(parseRecentViews(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   '])('treats %p as empty', (input) => {
    expect(parseRecentViews(input)).toBeNull();
  });

  it.each([
    'abc',
    '4.27%',
    '1.3',
    '-5',
    '1.3X',
    '1..3M',
    'views',
    '1e6',
    '1300001000000',
    '1001B',
    -1,
    1.5,
    Number.NaN,
    {},
  ])('rejects %p', (input) => {
    expect(parseRecentViews(input)).toBe('invalid');
  });

  it('accepts the top of the range and nothing above it', () => {
    expect(parseRecentViews('1000000000000')).toBe('1000000000000');
    expect(parseRecentViews('1000B')).toBe('1000000000000');
    expect(parseRecentViews('1000000000001')).toBe('invalid');
  });

  it('parsePrimaryMetric picks Recent Views only for Threads', () => {
    expect(parsePrimaryMetric('threads', '1.3M')).toBe('1300000');
    expect(parsePrimaryMetric('instagram', '4.271')).toBe('4.27');
    expect(parsePrimaryMetric('tiktok', '1.3M')).toBe('invalid');
    expect(parsePrimaryMetric(null, '5%')).toBe('5.00');
  });

  it('manual mode validates Threads with the Recent Views rule and message', () => {
    const { accepted, rejected } = validateManualGuests([
      { profileLink: 'https://www.threads.net/@one', name: 'One', followerCount: '10', engagementRate: '1.3M' },
      { profileLink: 'https://www.threads.com/@two', name: 'Two', followerCount: '10', engagementRate: '4.5%' },
      { profileLink: 'https://example.com/three', name: 'Three', selectedPlatform: 'threads', engagementRate: '850k' },
    ]);
    expect(accepted.map((g) => [g.platform, g.engagementRate])).toEqual([
      ['threads', '1300000'],
      ['threads', '850000'],
    ]);
    expect(rejected).toEqual([
      {
        profileLink: 'https://www.threads.com/@two',
        code: 'INVALID_ENGAGEMENT_RATE',
        message: 'Enter recent views as a whole number, for example 1,300,000 or 1.3M.',
      },
    ]);
  });
});

describe('Threads is never scraped', () => {
  const config: ExtractionConfig = {
    token: 't',
    scrapers: SCRAPERS,
    pollTimeoutSeconds: 10,
    maxPostsPerProfile: 20,
    maxTotalPostsPerProfile: 40,
    workerConcurrency: 1,
    maxActiveExtractionsPerAdmin: Number.POSITIVE_INFINITY,
    maxProfilesPerBatch: Number.POSITIVE_INFINITY,
    cacheTtlMs: 0,
    retentionMs: 86_400_000,
    receiptTtlMs: 1_800_000,
    featureEnabled: true,
  };

  const makeGateway = (): ScraperGateway => ({
    startJob: jest.fn(async () => ({ ok: true as const, runId: 'sd_x' })),
    getJob: jest.fn(),
    listItems: jest.fn(),
    cancelJob: jest.fn(),
    findRecentJobs: jest.fn(async () => []),
  });

  it('has no Threads scraper configured', () => {
    expect(Object.keys(SCRAPERS).sort()).toEqual(['instagram', 'tiktok']);
  });

  it('rejects a Threads link before any persistence or paid job', async () => {
    const gateway = makeGateway();
    const store: any = {
      guestProfileIdentityConflict: { findUnique: jest.fn() },
      guestProfileExtraction: { create: jest.fn(), findFirst: jest.fn() },
    };
    const deps = { store, gateway, config, enqueue: jest.fn() } as unknown as ExtractionDeps;

    const outcome = await startExtraction(
      {
        campaignId: 'c1',
        requesterUserId: 'u1',
        profileLink: 'https://www.threads.com/@pandapandiy_',
        idempotencyKey: 'key-12345678',
      },
      deps,
    );

    expect(outcome).toMatchObject({ status: 'rejected', code: 'UNSUPPORTED_PLATFORM' });
    expect(store.guestProfileExtraction.create).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(gateway.startJob).not.toHaveBeenCalled();
  });

  it('fails a queued legacy Threads row without starting a job', async () => {
    const record: any = {
      id: 'ext-1',
      status: 'QUEUED',
      platform: 'threads',
      canonicalProfileKey: 'threads:pandapandiy_',
      canonicalProfileUrl: 'https://www.threads.com/@pandapandiy_',
      actorRunId: null,
      profileActorRunId: null,
    };
    const store: any = {
      guestProfileExtraction: {
        findUnique: jest.fn(async () => record),
        update: jest.fn(async ({ data }: any) => Object.assign(record, data)),
      },
    };
    const gateway = makeGateway();
    const deps: ExtractionDeps = { store, gateway, config, enqueue: jest.fn() };

    await processExtraction('ext-1', deps);

    expect(gateway.startJob).not.toHaveBeenCalled();
    expect(record).toMatchObject({ status: 'FAILED', failureCode: 'UNSUPPORTED_PLATFORM' });
  });
});

describe('Threads typed Recent Views on an in-flight attach', () => {
  const context = { loadExtraction: async () => null } as never;

  it('rejects an invalid typed value, because no fetch will fill it', async () => {
    const { accepted, rejected } = await validateSubmittedGuests(
      [{ profileLink: 'https://www.threads.com/@abc7la', engagementRate: '1.2.3M', extractionId: 'ext-1' }],
      context,
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ code: 'INVALID_ENGAGEMENT_RATE' });
  });

  it('still ignores junk typed on an Instagram in-flight attach', async () => {
    const { rejected } = await validateSubmittedGuests(
      [{ profileLink: 'https://www.instagram.com/abc7la', engagementRate: 'abc', extractionId: 'ext-1' }],
      context,
    );
    expect(rejected[0]?.code).not.toBe('INVALID_ENGAGEMENT_RATE');
  });
});

describe('Threads metric provenance', () => {
  const original = { name: 'Abc', followerCount: 36, engagementRate: null };

  it('labels typed Recent Views as entered by hand, not as an edit of the fetch', () => {
    const result = classifyMetricProvenance({
      receiptVerified: true,
      platform: 'threads',
      original,
      final: { ...original, engagementRate: '1300000' },
    });
    expect(result.source).toBe('manual_override');
    expect(result.overrideReason).toBe('Threads recent views entered by hand.');
  });

  it('names a fetched-field edit and the typed views together', () => {
    const result = classifyMetricProvenance({
      receiptVerified: true,
      platform: 'threads',
      original,
      final: { ...original, followerCount: 40, engagementRate: '1300000' },
    });
    expect(result.overrideReason).toBe(
      'Admin edited followerCount after the fetch. Threads recent views entered by hand.',
    );
  });

  it('keeps the old wording on other platforms', () => {
    const result = classifyMetricProvenance({
      receiptVerified: true,
      platform: 'instagram',
      original: { ...original, engagementRate: '5.00' },
      final: { ...original, engagementRate: '6.00' },
    });
    expect(result.overrideReason).toBe('Admin edited engagementRate after the fetch.');
  });
});
