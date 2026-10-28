import axios from 'axios';
import { google } from 'googleapis';
import type { AppPlatform } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { compareVersions } from './app-version.service';

const IOS_BUNDLE_ID = 'com.cultcreative.app';
const IOS_COUNTRY = 'my';
const ANDROID_PACKAGE = 'com.cultcreative.app';
const SEMVER_IN_TEXT = /\d+\.\d+\.\d+/;

interface PlayRelease {
  name?: string | null;
  status?: string | null;
}

export type SyncOutcome = 'updated' | 'unchanged' | 'skipped';

export const fetchIosStoreVersion = async (): Promise<string | null> => {
  const { data } = await axios.get('https://itunes.apple.com/lookup', {
    params: { bundleId: IOS_BUNDLE_ID, country: IOS_COUNTRY },
    timeout: 10000,
  });
  return data?.results?.[0]?.version ?? null;
};

// Play has no versionName field on a track. A release name defaults to the
// bundle's versionName (e.g. "1.2.0" or "12 (1.2.0)"), so read it from there.
// Only "completed" releases count: a staged rollout is not live for everyone.
export const pickPlayVersion = (releases: PlayRelease[]): string | null =>
  releases
    .filter((release) => release.status === 'completed')
    .map((release) => release.name?.match(SEMVER_IN_TEXT)?.[0])
    .filter((version): version is string => !!version)
    .sort(compareVersions)
    .pop() ?? null;

const hasPlayCredentials = () =>
  !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL && !!process.env.GOOGLE_PLAY_PRIVATE_KEY;

// iOS uses the public iTunes lookup, so only Android can be off
export const isStoreSyncEnabled = (platform: AppPlatform) => platform === 'IOS' || hasPlayCredentials();

export const fetchAndroidStoreVersion = async (): Promise<string | null> => {
  if (!hasPlayCredentials()) return null;
  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PLAY_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const publisher = google.androidpublisher({ version: 'v3', auth });

  const { data: edit } = await publisher.edits.insert({ packageName: ANDROID_PACKAGE });
  const editId = edit.id as string;
  try {
    const { data: track } = await publisher.edits.tracks.get({
      packageName: ANDROID_PACKAGE,
      editId,
      track: 'production',
    });
    return pickPlayVersion(track.releases ?? []);
  } finally {
    await publisher.edits.delete({ packageName: ANDROID_PACKAGE, editId }).catch(() => undefined);
  }
};

const STORE_FETCHERS: Record<AppPlatform, () => Promise<string | null>> = {
  IOS: () => fetchIosStoreVersion(),
  ANDROID: () => fetchAndroidStoreVersion(),
};

const STORE_VERSION_CACHE_MS = 5 * 60 * 1000;
const storeVersionCache = new Map<AppPlatform, { version: string | null; at: number }>();

// Version live in the store, for the admin page. Null when the store can't be read.
export const getStoreVersion = async (platform: AppPlatform): Promise<string | null> => {
  const cached = storeVersionCache.get(platform);
  if (cached && Date.now() - cached.at < STORE_VERSION_CACHE_MS) return cached.version;

  try {
    const version = await STORE_FETCHERS[platform]();
    storeVersionCache.set(platform, { version, at: Date.now() });
    return version;
  } catch (error) {
    console.error(`[AppVersion] ${platform} store version read failed:`, error);
    return null;
  }
};

// Only ever raises latestVersion. minimumVersion is never touched here.
const syncPlatform = async (platform: AppPlatform, storeVersion: string | null): Promise<SyncOutcome> => {
  if (!storeVersion) return 'skipped';

  const policy = await prisma.appVersionPolicy.findUnique({ where: { platform } });
  if (!policy || compareVersions(storeVersion, policy.latestVersion) <= 0) return 'unchanged';

  // updatedById null = changed by the store sync, not a person
  await prisma.appVersionPolicy.update({
    where: { platform },
    data: { latestVersion: storeVersion, updatedById: null },
  });
  console.log(`[AppVersion] ${platform} latestVersion ${policy.latestVersion} → ${storeVersion}`);
  return 'updated';
};

const settle = async (fetchVersion: () => Promise<string | null>, platform: AppPlatform) => {
  try {
    return await syncPlatform(platform, await fetchVersion());
  } catch (error) {
    console.error(`[AppVersion] ${platform} store sync failed:`, error);
    return 'skipped' as const;
  }
};

export const syncLatestVersionsFromStores = async () => ({
  ios: await settle(fetchIosStoreVersion, 'IOS'),
  android: await settle(fetchAndroidStoreVersion, 'ANDROID'),
});
