import { NextFunction, Request, Response } from 'express';
import { prisma } from '@/src/prisma/prisma';
import {
  CreatorNoteError,
  MAX_NOTE_LENGTH,
  canAccessCampaignNotes,
  createNote,
  getSummary,
  getThread,
  markRead,
  setFollowing,
  setPinned,
} from './creator-note.service';
import { NoteUser } from './creator-note.types';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof CreatorNoteError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback });
};

const actorOf = (res: Response) => res.locals.noteActor as NoteUser;

/** Superadmins, or admins assigned to the campaign. Everyone else (clients, creators) gets 403. */
export const requireNotesAccess = async (req: Request, res: Response, next: NextFunction) => {
  const { campaignId } = req.params;
  if (!req.userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const [campaign, allowed, actor] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } }),
      canAccessCampaignNotes(req.userId, campaignId),
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, photoURL: true } }),
    ]);

    if (!allowed || !actor) return res.status(403).json({ message: 'Forbidden' });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    res.locals.noteActor = actor;
    return next();
  } catch (error) {
    return handleError(res, error, 'Error checking creator notes access');
  }
};

export const getSummaryHandler = async (req: Request, res: Response) => {
  try {
    return res.status(200).json(await getSummary(req.params.campaignId, actorOf(res).id));
  } catch (error) {
    return handleError(res, error, 'Error fetching creator notes summary');
  }
};

export const getThreadHandler = async (req: Request, res: Response) => {
  const { campaignId, creatorId } = req.params;

  try {
    return res.status(200).json(await getThread(campaignId, creatorId, actorOf(res).id));
  } catch (error) {
    return handleError(res, error, 'Error fetching creator notes');
  }
};

export const createNoteHandler = async (req: Request, res: Response) => {
  const { campaignId, creatorId } = req.params;
  const { text, pinned } = req.body ?? {};

  if (typeof text !== 'string') return res.status(400).json({ message: 'text is required' });
  if (pinned !== undefined && typeof pinned !== 'boolean') {
    return res.status(400).json({ message: 'pinned must be a boolean' });
  }

  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_NOTE_LENGTH) {
    return res.status(400).json({ message: `text must be 1 to ${MAX_NOTE_LENGTH} characters` });
  }

  try {
    const note = await createNote(campaignId, creatorId, actorOf(res), trimmed, pinned === true);
    return res.status(201).json(note);
  } catch (error) {
    return handleError(res, error, 'Error creating creator note');
  }
};

export const setPinnedHandler = async (req: Request, res: Response) => {
  const { campaignId, creatorId, noteId } = req.params;
  const { pinned } = req.body ?? {};

  if (typeof pinned !== 'boolean') return res.status(400).json({ message: 'pinned must be a boolean' });

  try {
    return res.status(200).json(await setPinned(campaignId, creatorId, noteId, pinned, actorOf(res)));
  } catch (error) {
    return handleError(res, error, 'Error updating pinned note');
  }
};

export const markReadHandler = async (req: Request, res: Response) => {
  const { campaignId, creatorId } = req.params;

  try {
    return res.status(200).json(await markRead(campaignId, creatorId, actorOf(res).id));
  } catch (error) {
    return handleError(res, error, 'Error marking creator notes as read');
  }
};

export const setFollowingHandler = async (req: Request, res: Response) => {
  const { campaignId, creatorId } = req.params;
  const { following } = req.body ?? {};

  if (typeof following !== 'boolean') return res.status(400).json({ message: 'following must be a boolean' });

  try {
    return res.status(200).json(await setFollowing(campaignId, creatorId, actorOf(res).id, following));
  } catch (error) {
    return handleError(res, error, 'Error updating follow state');
  }
};
