import { ReleaseNoteStatus } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { getIo } from '@configs/socket';
import { ReleaseNoteInput, ReleaseNoteItemInput } from './release-note.types';

const withItems = { items: { orderBy: { order: 'asc' as const } } };

const toItemRows = (items: ReleaseNoteItemInput[]) =>
  items.map((item, index) => ({
    type: item.type,
    title: item.title.trim(),
    description: item.description.trim(),
    order: index,
  }));

const publishedFields = () => ({ status: ReleaseNoteStatus.PUBLISHED, publishedAt: new Date() });

const notifyReleaseNotesChanged = () => {
  try {
    getIo().emit('releaseNotes:changed');
  } catch (error) {
    console.error('Failed to emit releaseNotes:changed:', error);
  }
};

export const listPublishedReleaseNotes = () =>
  prisma.releaseNote.findMany({
    where: { status: ReleaseNoteStatus.PUBLISHED },
    include: withItems,
    orderBy: [{ releaseDate: 'desc' }, { publishedAt: 'desc' }],
  });

export const listAllReleaseNotes = () =>
  prisma.releaseNote.findMany({
    include: withItems,
    orderBy: [{ releaseDate: 'desc' }, { createdAt: 'desc' }],
  });

export const getUnseenReleaseNote = async (userId: string) => {
  const [user, latest] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { lastSeenReleaseNoteAt: true } }),
    prisma.releaseNote.findFirst({
      where: { status: ReleaseNoteStatus.PUBLISHED },
      include: withItems,
      orderBy: { publishedAt: 'desc' },
    }),
  ]);

  if (!latest?.publishedAt) return null;
  if (user?.lastSeenReleaseNoteAt && user.lastSeenReleaseNoteAt >= latest.publishedAt) return null;

  return latest;
};

export const markReleaseNotesSeen = async (userId: string) => {
  await prisma.user.update({
    where: { id: userId },
    data: { lastSeenReleaseNoteAt: new Date() },
    select: { id: true },
  });
};

export const createReleaseNote = async (userId: string, input: ReleaseNoteInput) => {
  const note = await prisma.releaseNote.create({
    data: {
      releaseDate: input.releaseDate,
      createdById: userId,
      ...(input.publish ? publishedFields() : {}),
      items: { create: toItemRows(input.items) },
    },
    include: withItems,
  });

  if (input.publish) notifyReleaseNotesChanged();

  return note;
};

export const updateReleaseNote = async (id: string, input: ReleaseNoteInput) => {
  const existing = await prisma.releaseNote.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return null;

  const shouldPublish = input.publish && existing.status === ReleaseNoteStatus.DRAFT;

  const note = await prisma.releaseNote.update({
    where: { id },
    data: {
      releaseDate: input.releaseDate,
      ...(shouldPublish ? publishedFields() : {}),
      items: { deleteMany: {}, create: toItemRows(input.items) },
    },
    include: withItems,
  });

  if (shouldPublish) notifyReleaseNotesChanged();

  return note;
};

export const deleteReleaseNote = async (id: string) => {
  const existing = await prisma.releaseNote.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return false;

  await prisma.releaseNote.delete({ where: { id } });

  if (existing.status === ReleaseNoteStatus.PUBLISHED) notifyReleaseNotesChanged();

  return true;
};
