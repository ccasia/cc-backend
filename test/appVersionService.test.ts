jest.mock('../src/prisma/prisma', () => ({
  prisma: { appVersionPolicy: { findUnique: jest.fn() } },
}));

import { prisma } from '../src/prisma/prisma';
import { checkAppVersion, compareVersions } from '../src/modules/app-version/app-version.service';

const db = prisma as any;
const policy = {
  platform: 'IOS',
  minimumVersion: '1.2.0',
  latestVersion: '1.4.0',
  storeUrl: 'https://apps.apple.com/app/id1',
  message: null,
};

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.5', '1.0.10')).toBeLessThan(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
  });
});

describe('checkAppVersion', () => {
  it.each([
    ['1.1.9', 'force'],
    ['1.2.0', 'soft'],
    ['1.3.5', 'soft'],
    ['1.4.0', 'none'],
    ['1.5.0', 'none'],
  ])('version %s → %s', async (version, action) => {
    db.appVersionPolicy.findUnique.mockResolvedValue(policy);
    await expect(checkAppVersion('IOS' as any, version)).resolves.toMatchObject({ action });
  });

  it('returns none when no policy row exists', async () => {
    db.appVersionPolicy.findUnique.mockResolvedValue(null);
    await expect(checkAppVersion('ANDROID' as any, '0.0.1')).resolves.toMatchObject({ action: 'none' });
  });
});
