import type { AppPlatform } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { compareVersions } from './app-version.service';
import { getStoreVersion, isStoreSyncEnabled } from './app-version.store-sync';

export interface PolicyUpdateInput {
  minimumVersion?: string;
  latestVersion?: string;
  message?: string | null;
}

const withEditor = { updatedBy: { select: { id: true, name: true } } };

export const listAppVersionPolicies = async () => {
  const policies = await prisma.appVersionPolicy.findMany({ orderBy: { platform: 'asc' }, include: withEditor });
  return Promise.all(
    policies.map(async (policy) => ({
      ...policy,
      storeSyncEnabled: isStoreSyncEnabled(policy.platform),
      storeVersion: await getStoreVersion(policy.platform),
    })),
  );
};

export const updateAppVersionPolicy = async (platform: AppPlatform, input: PolicyUpdateInput, userId: string) => {
  const current = await prisma.appVersionPolicy.findUnique({ where: { platform } });
  if (!current) return { ok: false, status: 404, message: 'Policy not found' } as const;

  const latestVersion = input.latestVersion ?? current.latestVersion;
  const minimumVersion = input.minimumVersion ?? current.minimumVersion;
  const message = input.message === undefined ? current.message : input.message?.trim() || null;

  // Latest can only go down to the version live in the store, never below it
  if (compareVersions(latestVersion, current.latestVersion) < 0) {
    const storeVersion = await getStoreVersion(platform);
    const floor =
      storeVersion && compareVersions(storeVersion, current.latestVersion) < 0 ? storeVersion : current.latestVersion;

    if (compareVersions(latestVersion, floor) < 0) {
      return {
        ok: false,
        status: 400,
        message: storeVersion
          ? `Enter ${floor} or higher. The latest version can't go below the store version.`
          : `Enter ${floor} or higher. The store version is unknown, so the latest version can't be lowered.`,
      } as const;
    }
  }
  // Forcing users to a version the store does not have would lock them out
  if (compareVersions(minimumVersion, latestVersion) > 0) {
    return {
      ok: false,
      status: 400,
      message: `Enter a minimum version of ${latestVersion} or lower. Users can't update to a version that isn't in the store yet.`,
    } as const;
  }

  const updated = await prisma.appVersionPolicy.update({
    where: { platform },
    data: { minimumVersion, latestVersion, message, updatedById: userId },
    include: withEditor,
  });

  console.log(`[AppVersion] ${platform} policy updated by ${userId}`, {
    from: { minimumVersion: current.minimumVersion, latestVersion: current.latestVersion, message: current.message },
    to: { minimumVersion, latestVersion, message },
  });

  return { ok: true, data: updated } as const;
};
