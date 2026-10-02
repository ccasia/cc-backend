import { Request, Response } from 'express';
import { ReleaseNoteItemType } from '@prisma/client';
import {
  createReleaseNote,
  deleteReleaseNote,
  getUnseenReleaseNote,
  listAllReleaseNotes,
  listPublishedReleaseNotes,
  markReleaseNotesSeen,
  updateReleaseNote,
} from './release-note.service';
import { ReleaseNoteInput, Result } from './release-note.types';

const ITEM_TYPES: string[] = Object.values(ReleaseNoteItemType);

const isValidItem = (item: any) =>
  ITEM_TYPES.includes(item?.type) &&
  typeof item?.title === 'string' &&
  item.title.trim().length > 0 &&
  item.title.trim().length <= 255 &&
  typeof item?.description === 'string' &&
  item.description.trim().length > 0;

const parseReleaseNoteInput = (body: any): Result<ReleaseNoteInput> => {
  const releaseDate = new Date(body?.releaseDate);

  if (!body?.releaseDate || Number.isNaN(releaseDate.getTime())) {
    return { ok: false, status: 400, message: 'A valid release date is required' };
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { ok: false, status: 400, message: 'Add at least one update' };
  }
  if (!body.items.every(isValidItem)) {
    return {
      ok: false,
      status: 400,
      message: 'Every update needs a type, a title (max 255 chars) and a description',
    };
  }

  return { ok: true, data: { releaseDate, items: body.items, publish: body.publish === true } };
};

const serverError = (res: Response, error: unknown, message: string) => {
  console.error(`${message}:`, error);
  return res.status(500).json({ message });
};

// GET /api/release-notes — published releases (all admins)
export const getPublishedReleaseNotesHandler = async (_req: Request, res: Response) => {
  try {
    const data = await listPublishedReleaseNotes();
    return res.status(200).json({ data });
  } catch (error) {
    return serverError(res, error, 'Failed to fetch release notes');
  }
};

// GET /api/release-notes/unseen — latest release if not yet seen (all admins).
// Fails soft: a broken check should never block the dashboard with an error.
export const getUnseenReleaseNoteHandler = async (req: Request, res: Response) => {
  try {
    const data = await getUnseenReleaseNote(req.userId!);
    return res.status(200).json({ data });
  } catch (error) {
    console.error('Failed to fetch unseen release note:', error);
    return res.status(200).json({ data: null });
  }
};

// POST /api/release-notes/seen — mark releases as seen (all admins)
export const markReleaseNotesSeenHandler = async (req: Request, res: Response) => {
  try {
    await markReleaseNotesSeen(req.userId!);
    return res.status(200).json({ message: 'Marked as seen' });
  } catch (error) {
    return serverError(res, error, 'Failed to mark release notes as seen');
  }
};

// GET /api/release-notes/manage — all releases incl. drafts (superadmin)
export const getAllReleaseNotesHandler = async (_req: Request, res: Response) => {
  try {
    const data = await listAllReleaseNotes();
    return res.status(200).json({ data });
  } catch (error) {
    return serverError(res, error, 'Failed to fetch release notes');
  }
};

// POST /api/release-notes (superadmin)
export const createReleaseNoteHandler = async (req: Request, res: Response) => {
  const input = parseReleaseNoteInput(req.body);
  if (!input.ok) return res.status(input.status).json({ message: input.message });

  try {
    const data = await createReleaseNote(req.userId!, input.data);
    return res.status(201).json({ data });
  } catch (error) {
    return serverError(res, error, 'Failed to create release note');
  }
};

// PATCH /api/release-notes/:id (superadmin)
export const updateReleaseNoteHandler = async (req: Request, res: Response) => {
  const input = parseReleaseNoteInput(req.body);
  if (!input.ok) return res.status(input.status).json({ message: input.message });

  try {
    const data = await updateReleaseNote(req.params.id, input.data);
    if (!data) return res.status(404).json({ message: 'Release note not found' });
    return res.status(200).json({ data });
  } catch (error) {
    return serverError(res, error, 'Failed to update release note');
  }
};

// DELETE /api/release-notes/:id (superadmin)
export const deleteReleaseNoteHandler = async (req: Request, res: Response) => {
  try {
    const deleted = await deleteReleaseNote(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Release note not found' });
    return res.status(200).json({ message: 'Release note deleted' });
  } catch (error) {
    return serverError(res, error, 'Failed to delete release note');
  }
};
