import { SCRAPERS, type ExtractionConfig } from '../src/config/guestProfileExtractionConfig';
import type { JobSnapshot, ScraperGateway } from '../src/service/guestProfileExtraction/brightDataGateway';
import {
  parsePrimaryMetric,
  parseRecentViews,
  validateManualGuests,
  validateSubmittedGuests,
} from '../src/service/guestProfileExtraction/guestCreateService';
import { classifyMetricProvenance } from '../src/service/guestProfileExtraction/metricProvenance';
import {
  processExtraction,
  type ExtractionDeps,
} from '../src/service/guestProfileExtraction/guestProfileExtractionService';
import { normalizeProfileUrl } from '../src/service/guestProfileExtraction/profileUrlNormalizer';
import { parseThreadsOutput } from '../src/service/guestProfileExtraction/scraperAdapters/threadsAdapter';

const sampleRow = {
  url: 'https://www.threads.com/@pandapandiy_',
  profile_name: null,
  profile_id: '65557397377',
  about_formatted: '🇲🇾',
  number_of_followers: 36,
  website: null,
  instagram_profile_url: 'https://www.instagram.com/pandapandiy_',
  profile_picture: 'https://scontent.example.com/avatar.jpg',
  verified: false,
  threads: [{ likes: 3, comments: 1 }],
  timestamp: '2026-11-18T00:00:00.000Z',
  input: { url: 'https://www.threads.com/@pandapandiy_' },
};

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

describe('parseThreadsOutput', () => {
  it('reads the sample shape into a profile with no candidates', () => {
    expect(parseThreadsOutput({ items: [sampleRow], expectedUsername: 'pandapandiy_' })).toEqual({
      ok: true,
      profile: {
        platform: 'threads',
        username: 'pandapandiy_',
        displayName: null,
        biography: '🇲🇾',
        profilePictureUrl: 'https://scontent.example.com/avatar.jpg',
        followerCount: 36,
        isPrivate: false,
      },
      candidates: [],
    });
  });

  it('matches a threads.net URL and a differently cased handle', () => {
    const result = parseThreadsOutput({
      items: [{ ...sampleRow, url: 'https://threads.net/@PandaPandiy_', profile_name: 'Panda' }],
      expectedUsername: 'pandapandiy_',
    });
    expect(result).toMatchObject({ ok: true, profile: { displayName: 'Panda', followerCount: 36 } });
  });

  it('fails a row for another handle as PROFILE_NOT_FOUND', () => {
    const result = parseThreadsOutput({ items: [sampleRow], expectedUsername: 'someoneelse' });
    expect(result).toMatchObject({ ok: false, code: 'PROFILE_NOT_FOUND' });
  });

  it('fails an empty result as PROFILE_NOT_FOUND', () => {
    expect(parseThreadsOutput({ items: [], expectedUsername: 'pandapandiy_' })).toMatchObject({
      ok: false,
      code: 'PROFILE_NOT_FOUND',
    });
  });

  it('maps an error row', () => {
    const result = parseThreadsOutput({
      items: [{ error: 'Page does not exist', error_code: 'dead_page', input: { url: sampleRow.url } }],
      expectedUsername: 'pandapandiy_',
    });
    expect(result).toEqual({ ok: false, code: 'PROFILE_NOT_FOUND', message: 'dead_page: Page does not exist' });
  });

  it('fails a row with no url as PROVIDER_SCHEMA_CHANGED', () => {
    const { url: _url, ...noUrl } = sampleRow;
    expect(parseThreadsOutput({ items: [noUrl], expectedUsername: 'pandapandiy_' })).toMatchObject({
      ok: false,
      code: 'PROVIDER_SCHEMA_CHANGED',
    });
  });

  it('reports a failed job as PROVIDER_FAILURE', () => {
    expect(
      parseThreadsOutput({ items: [], error: { code: 'X', message: 'boom' }, expectedUsername: 'a' }),
    ).toMatchObject({ ok: false, code: 'PROVIDER_FAILURE' });
  });
});

describe('processExtraction for Threads', () => {
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

  it('runs one profile job and writes a READY row with no rate', async () => {
    const record: any = {
      id: 'ext-1',
      status: 'QUEUED',
      platform: 'threads',
      canonicalProfileKey: 'threads:pandapandiy_',
      canonicalProfileUrl: 'https://www.threads.com/@pandapandiy_',
      actorRunId: null,
      profileActorRunId: null,
    };
    const updates: any[] = [];
    const store: any = {
      guestProfileExtraction: {
        findUnique: jest.fn(async () => record),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          Object.assign(record, data);
          return record;
        }),
      },
    };
    const done: JobSnapshot = { jobId: 'sd_th', state: 'SUCCEEDED', errorMessage: null };
    const gateway: ScraperGateway = {
      startJob: jest.fn(async () => ({ ok: true as const, runId: 'sd_th' })),
      getJob: jest.fn(async () => done),
      listItems: jest.fn(async () => [sampleRow]),
      cancelJob: jest.fn(async () => undefined),
      findRecentJobs: jest.fn(async () => []),
    };
    const deps: ExtractionDeps = {
      store,
      gateway,
      config,
      enqueue: jest.fn(),
      sleep: async () => undefined,
      cacheThumbnail: async () => 'https://storage.example.com/avatar.jpg',
    };

    await processExtraction('ext-1', deps);

    expect(gateway.startJob).toHaveBeenCalledTimes(1);
    expect(gateway.startJob).toHaveBeenCalledWith({
      datasetId: 'gd_mde7jg3ld2h3hnnf2',
      discoverBy: null,
      input: [{ url: 'https://www.threads.com/@pandapandiy_' }],
    });
    expect(updates[0]).toMatchObject({ actorRunId: 'sd_th', actorId: 'gd_mde7jg3ld2h3hnnf2' });
    expect(record).toMatchObject({
      status: 'READY',
      profileActorRunId: null,
      resultName: 'pandapandiy_',
      resultFollowerCount: 36,
      resultBiography: '🇲🇾',
      resultProfilePictureUrl: 'https://storage.example.com/avatar.jpg',
      resultEngagementRate: null,
      sampleSize: 0,
      formulaVersion: 'threads_profile_v1',
      selectedPosts: [],
      candidatePosts: [],
    });
    expect(typeof record.receiptNonce).toBe('string');
    expect(typeof record.receiptDigest).toBe('string');
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
