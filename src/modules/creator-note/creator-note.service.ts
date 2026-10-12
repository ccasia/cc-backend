import { Prisma } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { getIo } from '@configs/socket';
import { NoteDto, NoteSummary, NoteUser, PinResult } from './creator-note.types';

export class CreatorNoteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_NOTE_LENGTH = 5000;

// Notes are admin-only. This room is separate from the plain campaign room,
// which clients also join.
export const notesRoom = (campaignId: string) => `campaign-notes:${campaignId}`;

const userSelect = { id: true, name: true, photoURL: true } satisfies Prisma.UserSelect;

const noteSelect = {
  id: true,
  campaignId: true,
  creatorId: true,
  text: true,
  mentions: true,
  isPinned: true,
  pinnedAt: true,
  createdAt: true,
  author: { select: userSelect },
} satisfies Prisma.CreatorNoteSelect;

// Same superadmin definition as the isAdmin middleware.
const superadminWhere: Prisma.UserWhereInput[] = [
  { role: 'superadmin' },
  { admin: { mode: { in: ['god', 'advanced'] } } },
];

/** Users (from `userIds`) that may read and write notes on the campaign. */
const filterAllowedUsers = async (campaignId: string, userIds: string[]): Promise<string[]> => {
  if (!userIds.length) return [];

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      role: { in: ['admin', 'superadmin'] },
      status: { not: 'deleted' },
      OR: [...superadminWhere, { admin: { campaignAdmin: { some: { campaignId } } } }],
    },
    select: { id: true },
  });

  return users.map((u) => u.id);
};

/** Superadmins, or admins with a CampaignAdmin row for the campaign. */
export const canAccessCampaignNotes = async (userId: string, campaignId: string): Promise<boolean> => {
  const allowed = await filterAllowedUsers(campaignId, [userId]);
  return allowed.length > 0;
};

const MENTION_PATTERN = /@\[[^\]]*\]\(([^)\s]+)\)/g;

export const parseMentionIds = (text: string): string[] => [
  ...new Set(Array.from(text.matchAll(MENTION_PATTERN), (m) => m[1])),
];

// One pinned note per thread: serialize pin changes for the same thread.
const lockThread = (tx: Prisma.TransactionClient, campaignId: string, creatorId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`creator-note:${campaignId}:${creatorId}`}))`;

const unpinCurrent = async (tx: Prisma.TransactionClient, campaignId: string, creatorId: string, exceptId?: string) => {
  const current = await tx.creatorNote.findFirst({
    where: { campaignId, creatorId, isPinned: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (!current) return null;

  return tx.creatorNote.update({
    where: { id: current.id },
    data: { isPinned: false, pinnedAt: null, pinnedById: null },
    select: noteSelect,
  });
};

const emit = (campaignId: string, event: string, payload: unknown) => {
  try {
    getIo().to(notesRoom(campaignId)).emit(event, payload);
  } catch (error) {
    console.error(`Failed to emit ${event}:`, error);
  }
};

export const getSummary = async (campaignId: string, userId: string): Promise<NoteSummary[]> => {
  const counts = await prisma.$queryRaw<{ creatorId: string; noteCount: bigint; unreadCount: bigint }[]>`
    SELECT n."creatorId",
           COUNT(*) AS "noteCount",
           COUNT(*) FILTER (
             WHERE n."authorId" <> ${userId}
               AND (rs."lastReadAt" IS NULL OR n."createdAt" > rs."lastReadAt")
           ) AS "unreadCount"
    FROM "CreatorNote" n
    LEFT JOIN "CreatorNoteReadState" rs
      ON rs."userId" = ${userId} AND rs."campaignId" = n."campaignId" AND rs."creatorId" = n."creatorId"
    WHERE n."campaignId" = ${campaignId}
    GROUP BY n."creatorId"
  `;

  if (!counts.length) return [];

  const [pinnedNotes, lastNotes] = await Promise.all([
    prisma.creatorNote.findMany({ where: { campaignId, isPinned: true }, select: noteSelect }),
    prisma.creatorNote.findMany({
      where: { campaignId },
      distinct: ['creatorId'],
      orderBy: [{ creatorId: 'asc' }, { createdAt: 'desc' }],
      select: noteSelect,
    }),
  ]);

  const pinnedBy = new Map(pinnedNotes.map((n) => [n.creatorId, n]));
  const lastBy = new Map(lastNotes.map((n) => [n.creatorId, n]));

  return counts.map((row) => ({
    creatorId: row.creatorId,
    noteCount: Number(row.noteCount),
    unreadCount: Number(row.unreadCount),
    pinned: pinnedBy.get(row.creatorId) ?? null,
    lastNote: lastBy.get(row.creatorId) ?? null,
  }));
};

export const getThread = async (campaignId: string, creatorId: string, userId: string) => {
  const [notes, pinned, campaignAdmins, readState] = await Promise.all([
    prisma.creatorNote.findMany({
      where: { campaignId, creatorId, isPinned: false },
      orderBy: { createdAt: 'asc' },
      select: noteSelect,
    }),
    prisma.creatorNote.findFirst({ where: { campaignId, creatorId, isPinned: true }, select: noteSelect }),
    prisma.campaignAdmin.findMany({
      where: { campaignId },
      select: { admin: { select: { user: { select: userSelect } } } },
    }),
    prisma.creatorNoteReadState.findUnique({
      where: { userId_campaignId_creatorId: { userId, campaignId, creatorId } },
      select: { following: true },
    }),
  ]);

  return {
    notes,
    pinned,
    participants: campaignAdmins.map((ca) => ca.admin.user),
    following: readState?.following ?? true,
  };
};

const assertCreatorOnCampaign = async (campaignId: string, creatorId: string) => {
  const [pitch, shortlisted] = await Promise.all([
    prisma.pitch.findFirst({ where: { campaignId, userId: creatorId }, select: { id: true } }),
    prisma.shortListedCreator.findFirst({ where: { campaignId, userId: creatorId }, select: { id: true } }),
  ]);

  if (!pitch && !shortlisted) throw new CreatorNoteError(404, 'Creator not found on this campaign');
};

export const createNote = async (
  campaignId: string,
  creatorId: string,
  author: NoteUser,
  text: string,
  pinned: boolean,
): Promise<NoteDto> => {
  await assertCreatorOnCampaign(campaignId, creatorId);

  const mentions = await filterAllowedUsers(campaignId, parseMentionIds(text));

  const { note, unpinned } = await prisma.$transaction(async (tx) => {
    let unpinnedNote: NoteDto | null = null;
    if (pinned) {
      await lockThread(tx, campaignId, creatorId);
      unpinnedNote = await unpinCurrent(tx, campaignId, creatorId);
    }

    const created = await tx.creatorNote.create({
      data: {
        campaignId,
        creatorId,
        authorId: author.id,
        text,
        mentions,
        ...(pinned ? { isPinned: true, pinnedAt: new Date(), pinnedById: author.id } : {}),
      },
      select: noteSelect,
    });

    return { note: created, unpinned: unpinnedNote };
  });

  emit(campaignId, 'creator-note:created', { campaignId, creatorId, note });
  // Creating a pinned note displaced the previous pin; tell clients so it drops back into the thread.
  if (unpinned) {
    emit(campaignId, 'creator-note:pin-updated', { campaignId, creatorId, pinned: note, unpinned, updatedBy: author });
  }

  void notifyNewNote(note).catch((error) => console.error('Failed to send creator note notifications:', error));

  return note;
};

export const setPinned = async (
  campaignId: string,
  creatorId: string,
  noteId: string,
  pinned: boolean,
  actor: NoteUser,
): Promise<PinResult> => {
  const result = await prisma.$transaction(async (tx): Promise<PinResult> => {
    await lockThread(tx, campaignId, creatorId);

    const note = await tx.creatorNote.findFirst({
      where: { id: noteId, campaignId, creatorId },
      select: noteSelect,
    });
    if (!note) throw new CreatorNoteError(404, 'Note not found');

    if (!pinned) {
      if (!note.isPinned) return { pinned: null, unpinned: null };

      const unpinnedNote = await tx.creatorNote.update({
        where: { id: noteId },
        data: { isPinned: false, pinnedAt: null, pinnedById: null },
        select: noteSelect,
      });
      return { pinned: null, unpinned: unpinnedNote };
    }

    if (note.isPinned) return { pinned: note, unpinned: null };

    const unpinnedNote = await unpinCurrent(tx, campaignId, creatorId, noteId);
    const pinnedNote = await tx.creatorNote.update({
      where: { id: noteId },
      data: { isPinned: true, pinnedAt: new Date(), pinnedById: actor.id },
      select: noteSelect,
    });
    return { pinned: pinnedNote, unpinned: unpinnedNote };
  });

  if (result.pinned || result.unpinned) {
    emit(campaignId, 'creator-note:pin-updated', { campaignId, creatorId, ...result, updatedBy: actor });
  }

  return result;
};

export const markRead = async (campaignId: string, creatorId: string, userId: string) => {
  const lastReadAt = new Date();
  await prisma.creatorNoteReadState.upsert({
    where: { userId_campaignId_creatorId: { userId, campaignId, creatorId } },
    create: { userId, campaignId, creatorId, lastReadAt },
    update: { lastReadAt },
  });
  return { lastReadAt };
};

export const setFollowing = async (campaignId: string, creatorId: string, userId: string, following: boolean) => {
  await prisma.creatorNoteReadState.upsert({
    where: { userId_campaignId_creatorId: { userId, campaignId, creatorId } },
    create: { userId, campaignId, creatorId, following },
    update: { following },
  });
  return { following };
};

/**
 * Mentioned users always get a notification. Campaign admins get one unless they
 * muted the thread; superadmins outside the campaign only if they explicitly follow it.
 * The author is never notified.
 */
const notifyNewNote = async (note: NoteDto) => {
  const { campaignId, creatorId } = note;

  const [campaignAdmins, readStates, campaign, creator] = await Promise.all([
    prisma.campaignAdmin.findMany({ where: { campaignId }, select: { adminId: true } }),
    prisma.creatorNoteReadState.findMany({
      where: { campaignId, creatorId },
      select: { userId: true, following: true },
    }),
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: creatorId }, select: { name: true } }),
  ]);

  const muted = new Set(readStates.filter((rs) => !rs.following).map((rs) => rs.userId));
  const followerCandidates = new Set([
    ...campaignAdmins.map((ca) => ca.adminId),
    ...readStates.filter((rs) => rs.following).map((rs) => rs.userId),
  ]);
  const followers = await filterAllowedUsers(
    campaignId,
    [...followerCandidates].filter((id) => !muted.has(id)),
  );

  const mentioned = new Set(note.mentions.filter((id) => id !== note.author.id));
  const recipients = new Set([...mentioned, ...followers.filter((id) => id !== note.author.id)]);
  if (!recipients.size) return;

  const authorName = note.author.name ?? 'An admin';
  const creatorName = creator?.name ?? 'a creator';
  const campaignName = campaign?.name ?? 'a campaign';
  const io = getIo();

  for (const userId of recipients) {
    const isMention = mentioned.has(userId);
    const data = await prisma.notification.create({
      data: {
        entity: 'CreatorNote',
        title: isMention ? 'You were mentioned in a creator note' : 'New creator note',
        message: isMention
          ? `${authorName} mentioned you in a note on ${creatorName} (${campaignName})`
          : `${authorName} added a note on ${creatorName} (${campaignName})`,
        campaignId,
        creatorId,
        userNotification: { create: { userId } },
      },
      include: { userNotification: { select: { userId: true } } },
    });

    io.to(userId).emit('notification', data);
  }
};
