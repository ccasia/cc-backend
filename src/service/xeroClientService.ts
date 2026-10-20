import { randomUUID } from 'crypto';
import axios from 'axios';
import dayjs from 'dayjs';
import { TokenSet, XeroClient } from 'xero-node';

import connection from '@configs/redis';
import { xeroClientConfig } from '@configs/xero';
import { prisma } from '@/src/prisma/prisma';

const REFRESH_LOCK_TTL_MS = 30_000;
const REFRESH_LOCK_POLL_MS = 250;
// Long enough that a bulk job started with this token does not hit a 401 halfway through.
const EXPIRY_MARGIN_SECONDS = 10 * 60;

/**
 * xero-node builds an ApiError from every axios error and reads `error.response`. A timeout or network
 * error has no response, so ApiError throws inside xero-node's promise and the call never settles:
 * the job hangs forever. Giving those errors a response makes the call reject like any other error.
 */
axios.interceptors.response.use(undefined, (error) => {
  if (error && !error.response && String(error.config?.url ?? '').includes('xero.com')) {
    error.response = { status: 0, data: { Message: `Xero request failed: ${error.message}` }, headers: {} };
    if (typeof error.request?.getHeaders !== 'function') error.request = { getHeaders: () => ({}) };
  }
  return Promise.reject(error);
});

const isExpiring = (tokenSet: TokenSet) =>
  !tokenSet?.expires_at || dayjs.unix(tokenSet.expires_at).subtract(EXPIRY_MARGIN_SECONDS, 'second').isBefore(dayjs());

const readTokenSet = async (adminUserId: string) => {
  const admin = await prisma.admin.findUnique({ where: { userId: adminUserId }, select: { xeroTokenSet: true } });
  return (admin?.xeroTokenSet as TokenSet) || null;
};

const newXeroClient = async () => {
  const client = new XeroClient(xeroClientConfig);
  await client.initialize();
  return client;
};

/** One refresh per admin at a time, across every API and worker process. */
const withRefreshLock = async <T>(adminUserId: string, task: () => Promise<T>): Promise<T> => {
  const key = `xero:refresh:${adminUserId}`;
  const owner = randomUUID();
  const deadline = Date.now() + REFRESH_LOCK_TTL_MS;

  while (!(await connection.set(key, owner, 'PX', REFRESH_LOCK_TTL_MS, 'NX'))) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the Xero token refresh lock');
    await new Promise((resolve) => setTimeout(resolve, REFRESH_LOCK_POLL_MS));
  }

  try {
    return await task();
  } finally {
    if ((await connection.get(key)) === owner) await connection.del(key);
  }
};

/**
 * A valid token set for this admin. Every refresh rotates the refresh token, so two processes
 * refreshing at once can save a dead one. The lock and the re-read make the second caller reuse
 * the token the first one saved.
 */
export const getFreshXeroTokenSet = async (adminUserId: string, client?: XeroClient): Promise<TokenSet> => {
  const tokenSet = await readTokenSet(adminUserId);
  if (!tokenSet) throw new Error('You are not connected to Xero');
  if (!isExpiring(tokenSet)) return tokenSet;

  return withRefreshLock(adminUserId, async () => {
    const latest = await readTokenSet(adminUserId);
    if (!latest) throw new Error('You are not connected to Xero');
    if (!isExpiring(latest)) return latest;

    const refresher = client ?? (await newXeroClient());
    refresher.setTokenSet(latest);
    const refreshed = await refresher.refreshToken();

    await prisma.admin.update({ where: { userId: adminUserId }, data: { xeroTokenSet: refreshed as any } });
    return refreshed;
  });
};

/**
 * A Xero client of its own for one admin. Tokens and tenants live on the client object, so a
 * client shared between concurrent jobs can call Xero with another admin's token or tenant list.
 */
export const getXeroClientForAdmin = async (adminUserId: string, { withTenants = true } = {}) => {
  const client = await newXeroClient();
  client.setTokenSet(await getFreshXeroTokenSet(adminUserId, client));
  if (withTenants) await client.updateTenants();
  return client;
};
