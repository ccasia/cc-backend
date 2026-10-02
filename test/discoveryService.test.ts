jest.mock('../src/prisma/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    campaignAdmin: { findFirst: jest.fn() },
    campaign: { findUnique: jest.fn() },
    submission: { findMany: jest.fn().mockResolvedValue([]) },
    postEngagementSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    creatorRating: { findMany: jest.fn().mockResolvedValue([]) },
    pitch: { findMany: jest.fn().mockResolvedValue([]) },
    bookMarkCreator: { findMany: jest.fn() },
    shortListedCreator: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/service/socialMediaService', () => ({ refreshTikTokToken: jest.fn() }));
jest.mock('../src/helper/discovery/platformContentResolver', () => ({
  resolvePlatformContentMatchesFromApi: jest
    .fn()
    .mockResolvedValue({ instagramTopVideosByCreator: new Map(), tiktokTopVideosByCreator: new Map() }),
}));
jest.mock('../src/helper/discovery/hydration', () => ({
  hydrateMissingInstagramData: jest.fn(),
  hydrateMissingTikTokData: jest.fn(),
}));
jest.mock('../src/config/socket', () => ({ clients: new Map(), getIo: jest.fn() }));
jest.mock('../src/controller/notificationController', () => ({ saveNotification: jest.fn() }));
jest.mock('../src/helper/encrypt', () => ({ encryptToken: jest.fn(), decryptToken: jest.fn() }));

import { prisma } from '../src/prisma/prisma';
import {
  getDiscoveryCreators,
  getDiscoveryCreatorsExportData,
  getBookmarkedCreatorsByLists,
  inviteDiscoveryCreators,
} from '../src/service/discoveryService';
import { resolvePlatformContentMatchesFromApi } from '../src/helper/discovery/platformContentResolver';

const db = prisma as any;
const users = [
  {
    id: 'a',
    name: 'Alpha',
    creator: {
      id: 'ca',
      discoveryProfiles: [
        { platform: 'instagram', followers: 20, captions: '#food caption' },
        { platform: 'tiktok', followers: 100, captions: '#gaming post' },
      ],
    },
  },
  {
    id: 'z',
    name: 'Zed',
    creator: { id: 'cz', isGuest: true, discoveryProfiles: [{ platform: 'instagram', followers: 200 }] },
  },
];
beforeEach(() => {
  db.user.findMany.mockImplementation(async ({ where, select }: any) => {
    if (!select.creator) return [];
    if (where.id?.in) return users.filter((user) => where.id.in.includes(user.id));
    return users;
  });
  db.$transaction.mockImplementation((callback: any) => callback(db));
});

test('globally sorts platform rows, counts rows, and loads only the selected page', async () => {
  const result = await getDiscoveryCreators({ sortBy: 'followers', page: 2, limit: 1 });
  expect(result.pagination.total).toBe(3);
  expect(result.data.map((row: any) => row.rowId)).toEqual(['a-tiktok']);
  const fullQueries = db.user.findMany.mock.calls.map(([query]: any[]) => query).filter((query: any) => query.where.id);
  expect(fullQueries).toHaveLength(1);
  expect(fullQueries[0].where.id.in).toEqual(['a']);
  expect(resolvePlatformContentMatchesFromApi).toHaveBeenCalledTimes(1);
});

test('grid and export return identical platform content matches', async () => {
  const input = { keyword: 'gaming', hashtag: '#gaming', platform: 'all' as const };
  const grid = await getDiscoveryCreators(input);
  const exported = await getDiscoveryCreatorsExportData(input);
  expect(grid.data.map((row: any) => row.rowId)).toEqual(['a-tiktok']);
  expect(exported.data).toEqual(grid.data);
  expect(exported.total).toBe(1);
});

test('bookmarks use the same mapping and retain guest profiles', async () => {
  db.bookMarkCreator.findMany.mockResolvedValue([{ creatorUserId: 'z', platform: 'instagram' }]);
  const result = await getBookmarkedCreatorsByLists('admin', ['list']);
  expect(result.data[0]).toMatchObject({
    rowId: 'z-instagram',
    isGuest: true,
    instagram: { followers: 200, connected: false },
  });
});

test.each([['guest'], ['guest', 'registered']])(
  'rejects single and bulk guest invitations before writes: %j',
  async (...args) => {
    db.user.findUnique.mockResolvedValue({ role: 'superadmin' });
    db.campaignAdmin.findFirst.mockResolvedValue({});
    db.campaign.findUnique.mockResolvedValue({ id: 'campaign', submissionVersion: 'v4', campaignAdmin: [] });
    db.user.findMany.mockResolvedValue([{ id: 'guest', creator: { isGuest: true } }]);
    await expect(
      inviteDiscoveryCreators({ campaignId: 'campaign', invitedByUserId: 'admin', creatorIds: args as string[] }),
    ).rejects.toThrow('Non-platform creators must be added through Master List');
  },
);
