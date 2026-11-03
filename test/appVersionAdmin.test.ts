jest.mock('googleapis', () => ({ google: {} }));
jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ data: { results: [{ version: '1.0.4' }] } }) }));
jest.mock('../src/prisma/prisma', () => ({
  prisma: { appVersionPolicy: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } },
}));

import { prisma } from '../src/prisma/prisma';
import { listAppVersionPolicies, updateAppVersionPolicy } from '../src/modules/app-version/app-version.admin';

const db = prisma as any;
const current = { platform: 'IOS', minimumVersion: '1.0.0', latestVersion: '1.2.0', message: 'old' };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  db.appVersionPolicy.findUnique.mockResolvedValue(current);
  db.appVersionPolicy.update.mockImplementation(({ data }: any) => Promise.resolve({ ...current, ...data }));
});

describe('updateAppVersionPolicy', () => {
  it('raises minimumVersion up to latestVersion and records the editor', async () => {
    const result = await updateAppVersionPolicy('IOS' as any, { minimumVersion: '1.2.0' }, 'admin-1');

    expect(result.ok).toBe(true);
    expect(db.appVersionPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { minimumVersion: '1.2.0', latestVersion: '1.2.0', message: 'old', updatedById: 'admin-1' },
      }),
    );
  });

  it('rejects minimumVersion above latestVersion', async () => {
    const result = await updateAppVersionPolicy('IOS' as any, { minimumVersion: '1.3.0' }, 'admin-1');

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(db.appVersionPolicy.update).not.toHaveBeenCalled();
  });

  it('allows raising both together', async () => {
    const result = await updateAppVersionPolicy(
      'IOS' as any,
      { minimumVersion: '1.3.0', latestVersion: '1.3.0' },
      'admin-1',
    );

    expect(result.ok).toBe(true);
  });

  it('lowers latestVersion down to the store version', async () => {
    const result = await updateAppVersionPolicy('IOS' as any, { latestVersion: '1.0.4' }, 'admin-1');

    expect(result.ok).toBe(true);
  });

  it('never lowers latestVersion below the store version', async () => {
    const result = await updateAppVersionPolicy('IOS' as any, { latestVersion: '1.0.3' }, 'admin-1');

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(db.appVersionPolicy.update).not.toHaveBeenCalled();
  });

  it('never lowers latestVersion when the store version is unknown', async () => {
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_PLAY_PRIVATE_KEY;
    const result = await updateAppVersionPolicy('ANDROID' as any, { latestVersion: '1.1.0' }, 'admin-1');

    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('clears a blank message', async () => {
    await updateAppVersionPolicy('IOS' as any, { message: '   ' }, 'admin-1');

    expect(db.appVersionPolicy.update.mock.calls[0][0].data.message).toBeNull();
  });

  it('returns 404 when the platform row is missing', async () => {
    db.appVersionPolicy.findUnique.mockResolvedValue(null);

    await expect(updateAppVersionPolicy('ANDROID' as any, { message: 'x' }, 'admin-1')).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe('listAppVersionPolicies', () => {
  it('adds the live store version and flags Android sync as off without Play credentials', async () => {
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_PLAY_PRIVATE_KEY;
    db.appVersionPolicy.findMany.mockResolvedValue([{ platform: 'ANDROID' }, { platform: 'IOS' }]);

    await expect(listAppVersionPolicies()).resolves.toEqual([
      { platform: 'ANDROID', storeSyncEnabled: false, storeVersion: null },
      { platform: 'IOS', storeSyncEnabled: true, storeVersion: '1.0.4' },
    ]);
  });
});
