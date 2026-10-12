const emit = jest.fn();
const to = jest.fn(() => ({ emit }));

jest.mock('../src/prisma/prisma', () => {
  const prisma: any = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    campaign: { findUnique: jest.fn() },
    campaignAdmin: { findMany: jest.fn() },
    creatorNote: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    creatorNoteReadState: { findMany: jest.fn() },
    notification: { create: jest.fn() },
    pitch: { findFirst: jest.fn() },
    shortListedCreator: { findFirst: jest.fn() },
    $executeRaw: jest.fn(),
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return { prisma };
});
jest.mock('../src/config/socket', () => ({ getIo: () => ({ to }) }));

import { prisma } from '../src/prisma/prisma';
import { createNote, parseMentionIds, setPinned } from '../src/modules/creator-note/creator-note.service';

const db = prisma as any;
const author = { id: 'admin-1', name: 'Mei Ling', photoURL: null };
const note = (overrides: Record<string, unknown> = {}) => ({
  id: 'note-1',
  campaignId: 'camp-1',
  creatorId: 'creator-1',
  text: 'hi',
  mentions: [],
  isPinned: false,
  pinnedAt: null,
  createdAt: new Date(),
  author,
  ...overrides,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('parseMentionIds', () => {
  it('extracts unique user ids from mention tokens', () => {
    expect(parseMentionIds('hey @[Mei Ling](u1) and @[Bob](u2), again @[Mei Ling](u1)')).toEqual(['u1', 'u2']);
  });

  it('ignores malformed tokens', () => {
    expect(parseMentionIds('@Mei Ling (u1) @[x]() @[y](a b)')).toEqual([]);
  });
});

describe('setPinned', () => {
  it('unpins the previous pinned note when pinning another', async () => {
    const previous = note({ id: 'note-0', isPinned: true });
    db.creatorNote.findFirst.mockResolvedValueOnce(note()).mockResolvedValueOnce({ id: 'note-0' });
    db.creatorNote.update
      .mockResolvedValueOnce({ ...previous, isPinned: false })
      .mockResolvedValueOnce(note({ isPinned: true }));

    const result = await setPinned('camp-1', 'creator-1', 'note-1', true, author);

    expect(result.unpinned?.id).toBe('note-0');
    expect(result.pinned?.id).toBe('note-1');
    expect(to).toHaveBeenCalledWith('campaign-notes:camp-1');
    expect(emit).toHaveBeenCalledWith('creator-note:pin-updated', expect.objectContaining({ updatedBy: author }));
  });

  it('unpinning keeps the note and only clears the flag', async () => {
    db.creatorNote.findFirst.mockResolvedValueOnce(note({ isPinned: true }));
    db.creatorNote.update.mockResolvedValueOnce(note());

    const result = await setPinned('camp-1', 'creator-1', 'note-1', false, author);

    expect(db.creatorNote.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isPinned: false, pinnedAt: null, pinnedById: null } }),
    );
    expect(result).toEqual({ pinned: null, unpinned: expect.objectContaining({ id: 'note-1' }) });
  });

  it('404s for a note outside the thread', async () => {
    db.creatorNote.findFirst.mockResolvedValueOnce(null);
    await expect(setPinned('camp-1', 'creator-1', 'nope', true, author)).rejects.toMatchObject({ status: 404 });
  });
});

describe('createNote', () => {
  it('keeps only allowed mentions and notifies mentions + followers, never the author or muted admins', async () => {
    db.pitch.findFirst.mockResolvedValue({ id: 'pitch-1' });
    db.shortListedCreator.findFirst.mockResolvedValue(null);
    // 1st call: mention filtering. 2nd call: follower filtering.
    db.user.findMany
      .mockResolvedValueOnce([{ id: 'admin-2' }])
      .mockResolvedValueOnce([{ id: 'admin-1' }, { id: 'admin-3' }]);
    db.creatorNote.create.mockImplementation(({ data }: any) => Promise.resolve(note({ mentions: data.mentions })));
    db.campaignAdmin.findMany.mockResolvedValue([{ adminId: 'admin-1' }, { adminId: 'admin-3' }, { adminId: 'admin-4' }]);
    db.creatorNoteReadState.findMany.mockResolvedValue([{ userId: 'admin-4', following: false }]);
    db.campaign.findUnique.mockResolvedValue({ name: 'Camp' });
    db.user.findUnique.mockResolvedValue({ name: 'Creator' });
    db.notification.create.mockResolvedValue({});

    const created = await createNote('camp-1', 'creator-1', author, 'hi @[A2](admin-2) @[Client](client-1)', false);
    await flush();

    expect(created.mentions).toEqual(['admin-2']);
    // admin-4 muted, so it must not be offered as a follower candidate.
    expect(db.user.findMany.mock.calls[1][0].where.id.in).not.toContain('admin-4');
    const notified = db.notification.create.mock.calls.map((c: any) => c[0].data.userNotification.create.userId);
    expect(notified.sort()).toEqual(['admin-2', 'admin-3']);
    expect(emit).toHaveBeenCalledWith('creator-note:created', expect.objectContaining({ creatorId: 'creator-1' }));
  });

  it('rejects creators not on the campaign', async () => {
    db.pitch.findFirst.mockResolvedValue(null);
    db.shortListedCreator.findFirst.mockResolvedValue(null);
    await expect(createNote('camp-1', 'stranger', author, 'hi', false)).rejects.toMatchObject({ status: 404 });
  });
});
