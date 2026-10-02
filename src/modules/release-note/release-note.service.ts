import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { ReleaseNoteStatus } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { getIo } from '@configs/socket';
import { ReleaseNoteInput, ReleaseNoteItemInput } from './release-note.types';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'Asia/Kuala_Lumpur';

const startOfTodayMYT = () =>
  new Date(`${dayjs().tz(TIMEZONE).format('YYYY-MM-DD')}T00:00:00.000Z`);

const isFutureRelease = (releaseDate: Date) => releaseDate > startOfTodayMYT();

const withItems = { items: { orderBy: { order: 'asc' as const } } };

const toItemRows = (items: ReleaseNoteItemInput[]) =>
  items.map((item, index) => ({
    type: item.type,
    title: item.title.trim(),
    description: item.description.trim(),
    order: index,
  }));

const publishTarget = (releaseDate: Date) =>
  isFutureRelease(releaseDate)
    ? { status: ReleaseNoteStatus.SCHEDULED, publishedAt: null }
    : { status: ReleaseNoteStatus.PUBLISHED, publishedAt: new Date() };

const resolveUpdateStatus = (current: ReleaseNoteStatus, input: ReleaseNoteInput) => {
  if (current === ReleaseNoteStatus.PUBLISHED) return {};
  if (input.publish) return publishTarget(input.releaseDate);
  return { status: ReleaseNoteStatus.DRAFT, publishedAt: null };
};

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
      ...(input.publish ? publishTarget(input.releaseDate) : {}),
      items: { create: toItemRows(input.items) },
    },
    include: withItems,
  });

  if (note.status === ReleaseNoteStatus.PUBLISHED) notifyReleaseNotesChanged();

  return note;
};

export const updateReleaseNote = async (id: string, input: ReleaseNoteInput) => {
  const existing = await prisma.releaseNote.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return null;

  const note = await prisma.releaseNote.update({
    where: { id },
    data: {
      releaseDate: input.releaseDate,
      ...resolveUpdateStatus(existing.status, input),
      items: { deleteMany: {}, create: toItemRows(input.items) },
    },
    include: withItems,
  });

  if (existing.status !== ReleaseNoteStatus.PUBLISHED && note.status === ReleaseNoteStatus.PUBLISHED) {
    notifyReleaseNotesChanged();
  }

  return note;
};

export const publishDueReleaseNotes = async () => {
  const { count } = await prisma.releaseNote.updateMany({
    where: { status: ReleaseNoteStatus.SCHEDULED, releaseDate: { lte: startOfTodayMYT() } },
    data: { status: ReleaseNoteStatus.PUBLISHED, publishedAt: new Date() },
  });

  if (count > 0) notifyReleaseNotesChanged();

  return { published: count };
};

export const deleteReleaseNote = async (id: string) => {
  const existing = await prisma.releaseNote.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return false;

  await prisma.releaseNote.delete({ where: { id } });

  if (existing.status === ReleaseNoteStatus.PUBLISHED) notifyReleaseNotesChanged();

  return true;
};
