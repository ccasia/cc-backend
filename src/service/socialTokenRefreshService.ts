import { decryptToken, encryptToken } from '@helper/encrypt';
import { refreshInstagramToken, refreshTikTokToken } from '@services/socialMediaService';
import { prisma } from '@/src/prisma/prisma';

const DAY = 24 * 60 * 60;
const BATCH_SIZE = 10;

/**
 * Meta refreshes a long-lived Instagram token only while it is still valid
 * (and at least 24 hours old). An expired token cannot be refreshed; the
 * creator must connect again. Each refresh gives 60 more days, so a token
 * refreshed inside this window never expires.
 */
const INSTAGRAM_TOKEN_LIFETIME = 60 * DAY;
const INSTAGRAM_REFRESH_WINDOW = 30 * DAY;

/**
 * A TikTok refresh token lasts 180 days and is replaced on every refresh.
 * Refreshing this often keeps it alive for creators no campaign reads.
 */
const TIKTOK_REFRESH_INTERVAL = 30 * DAY;
/** Connect stores TikTok's relative `expires_in` in seconds; a refresh stores a Unix time. */
const UNIX_TIME_FLOOR = 1_000_000_000;

export type InstagramTokenAction = 'USE' | 'REFRESH' | 'EXPIRED';

export interface TokenRefreshResult {
  evaluated: number;
  refreshed: number;
  failed: number;
}

interface StoredInstagramToken {
  creatorId: string;
  accessToken: unknown;
  expiresIn: number | null;
}

const unixTime = (date: Date) => Math.floor(date.getTime() / 1000);

export function instagramTokenAction(
  expiresIn: number | null | undefined,
  now: Date = new Date(),
): InstagramTokenAction {
  if (!expiresIn) return 'REFRESH';
  const secondsLeft = expiresIn - unixTime(now);
  if (secondsLeft <= 0) return 'EXPIRED';
  return secondsLeft <= INSTAGRAM_REFRESH_WINDOW ? 'REFRESH' : 'USE';
}

export function tiktokRefreshDue(tiktokData: unknown, now: Date = new Date()): boolean {
  const expiresIn = (tiktokData as { expires_in?: unknown } | null)?.expires_in;
  if (typeof expiresIn !== 'number' || expiresIn < UNIX_TIME_FLOOR) return true;
  return unixTime(now) - expiresIn >= TIKTOK_REFRESH_INTERVAL;
}

async function refreshStoredInstagramToken(creatorId: string, accessToken: string, now: Date): Promise<string> {
  const refreshed = await refreshInstagramToken(accessToken);

  await prisma.instagramUser.update({
    where: { creatorId },
    data: {
      accessToken: encryptToken(refreshed.access_token),
      expiresIn: unixTime(now) + (refreshed.expires_in ?? INSTAGRAM_TOKEN_LIFETIME),
    },
  });

  return refreshed.access_token;
}

/**
 * Returns a usable Instagram access token, refreshing it first when it is
 * inside the refresh window. A failed early refresh keeps the current token,
 * which is still valid. Only an expired token whose refresh fails throws.
 */
export async function getUsableInstagramToken(token: StoredInstagramToken, now: Date = new Date()): Promise<string> {
  const accessToken = decryptToken(token.accessToken as { iv: string; content: string })!;
  const action = instagramTokenAction(token.expiresIn, now);
  if (action === 'USE') return accessToken;

  try {
    return await refreshStoredInstagramToken(token.creatorId, accessToken, now);
  } catch (error) {
    if (action === 'EXPIRED') throw error;
    console.warn('[InstagramTokenRefresh] Early refresh failed, using current token', {
      creatorId: token.creatorId,
      message: (error as Error)?.message,
    });
    return accessToken;
  }
}

async function refreshInBatches<T extends { id: string }>(
  label: string,
  rows: T[],
  refresh: (row: T) => Promise<void>,
): Promise<{ refreshed: number; failed: number }> {
  let refreshed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.allSettled(batch.map(refresh));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        refreshed++;
        return;
      }
      failed++;
      console.error(`[${label}] Refresh failed for creator ${batch[index].id}:`, (result.reason as Error)?.message);
    });
  }

  return { refreshed, failed };
}

/** Daily cron: refreshes every connected Instagram token before it can expire. */
export async function refreshDueInstagramTokens(now: Date = new Date()): Promise<TokenRefreshResult> {
  const nowUnix = unixTime(now);
  const rows = await prisma.instagramUser.findMany({
    where: {
      creator: { isFacebookConnected: true },
      OR: [{ expiresIn: null }, { expiresIn: { gt: nowUnix, lte: nowUnix + INSTAGRAM_REFRESH_WINDOW } }],
    },
    select: { creatorId: true, accessToken: true },
  });

  const due = rows.filter((row) => row.accessToken).map((row) => ({ ...row, id: row.creatorId }));
  const { refreshed, failed } = await refreshInBatches('InstagramTokenRefresh', due, async (row) => {
    const accessToken = decryptToken(row.accessToken as { iv: string; content: string })!;
    await refreshStoredInstagramToken(row.creatorId, accessToken, now);
  });

  return { evaluated: rows.length, refreshed, failed };
}

/** Daily cron: refreshes TikTok tokens so the rotating refresh token never lapses. */
export async function refreshDueTiktokTokens(now: Date = new Date()): Promise<TokenRefreshResult> {
  const creators = await prisma.creator.findMany({
    where: { isTiktokConnected: true },
    select: { id: true, tiktokData: true },
  });

  const due = creators.filter(
    (creator) =>
      (creator.tiktokData as { refresh_token?: unknown })?.refresh_token && tiktokRefreshDue(creator.tiktokData, now),
  );
  const { refreshed, failed } = await refreshInBatches('TiktokTokenRefresh', due, async (creator) => {
    const tiktokData = creator.tiktokData as Record<string, any>;
    const result = await refreshTikTokToken(decryptToken(tiktokData.refresh_token)!);

    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        tiktokData: {
          ...tiktokData,
          access_token: encryptToken(result.access_token),
          refresh_token: encryptToken(result.refresh_token),
          expires_in: unixTime(now) + Number(result.expires_in ?? 0),
        },
      },
    });
  });

  return { evaluated: creators.length, refreshed, failed };
}
