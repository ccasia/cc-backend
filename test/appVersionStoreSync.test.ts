jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('googleapis', () => ({ google: {} }));
jest.mock('../src/prisma/prisma', () => ({
  prisma: { appVersionPolicy: { findUnique: jest.fn(), update: jest.fn() } },
}));

import axios from 'axios';
import { prisma } from '../src/prisma/prisma';
import { pickPlayVersion, syncLatestVersionsFromStores } from '../src/modules/app-version/app-version.store-sync';

const db = prisma as any;
const get = axios.get as jest.Mock;

beforeEach(() => {
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PLAY_PRIVATE_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('pickPlayVersion', () => {
  it('reads the highest completed release name', () => {
    expect(
      pickPlayVersion([
        { name: '12 (1.2.0)', status: 'completed' },
        { name: '1.10.0', status: 'completed' },
        { name: '1.11.0', status: 'inProgress' },
      ]),
    ).toBe('1.10.0');
  });

  it('returns null without a usable completed release', () => {
    expect(pickPlayVersion([{ name: 'Spring release', status: 'completed' }])).toBeNull();
    expect(pickPlayVersion([])).toBeNull();
  });
});

describe('syncLatestVersionsFromStores', () => {
  it('raises iOS latestVersion when the store is ahead and skips Android without credentials', async () => {
    get.mockResolvedValue({ data: { results: [{ version: '1.1.0' }] } });
    db.appVersionPolicy.findUnique.mockResolvedValue({ latestVersion: '1.0.5' });

    await expect(syncLatestVersionsFromStores()).resolves.toEqual({ ios: 'updated', android: 'skipped' });
    expect(db.appVersionPolicy.update).toHaveBeenCalledWith({
      where: { platform: 'IOS' },
      data: { latestVersion: '1.1.0', updatedById: null },
    });
  });

  it('never lowers latestVersion', async () => {
    get.mockResolvedValue({ data: { results: [{ version: '1.0.4' }] } });
    db.appVersionPolicy.findUnique.mockResolvedValue({ latestVersion: '1.0.5' });

    await expect(syncLatestVersionsFromStores()).resolves.toMatchObject({ ios: 'unchanged' });
    expect(db.appVersionPolicy.update).not.toHaveBeenCalled();
  });

  it('survives a store request failure', async () => {
    get.mockRejectedValue(new Error('network down'));

    await expect(syncLatestVersionsFromStores()).resolves.toMatchObject({ ios: 'skipped' });
  });
});
