import type { AppPlatform } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';

export type UpdateAction = 'none' | 'soft' | 'force';

export interface AppVersionCheck {
  action: UpdateAction;
  latestVersion: string | null;
  storeUrl: string | null;
  message: string | null;
}

export const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;

const toParts = (version: string) => {
  const parts = version.split('.').map((part) => Number(part));
  while (parts.length < 3) parts.push(0);
  return parts;
};

// Negative when a < b, zero when equal, positive when a > b
export const compareVersions = (a: string, b: string) => {
  const left = toParts(a);
  const right = toParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
};

export const checkAppVersion = async (platform: AppPlatform, version: string): Promise<AppVersionCheck> => {
  const policy = await prisma.appVersionPolicy.findUnique({ where: { platform } });

  if (!policy) return { action: 'none', latestVersion: null, storeUrl: null, message: null };

  let action: UpdateAction = 'none';
  if (compareVersions(version, policy.minimumVersion) < 0) action = 'force';
  else if (compareVersions(version, policy.latestVersion) < 0) action = 'soft';

  return {
    action,
    latestVersion: policy.latestVersion,
    storeUrl: policy.storeUrl,
    message: policy.message,
  };
};
