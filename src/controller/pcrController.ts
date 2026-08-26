import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';

import {
  deleteDraft,
  deleteSessionDraft,
  DraftStoreUnavailableError,
  flushDraftToDb,
  getDraft,
  getSessionDraft,
  isValidEditorSessionId,
  rebaseSessionDraft,
  setDraft,
  setSessionDraft,
} from '../service/pcrDraftService';
import type { SessionPcrDraft } from '../service/pcrDraftService';

const prisma = new PrismaClient();

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

const getEditorSessionId = (req: Request, res: Response): string | null => {
  const { editorSessionId } = req.params;
  if (!editorSessionId || !isValidEditorSessionId(editorSessionId)) {
    res.status(400).json({ success: false, message: 'Invalid editor session ID' });
    return null;
  }
  return editorSessionId;
};

const getRequiredUserId = (req: Request, res: Response): string | null => {
  if (!req.userId) {
    res.status(401).json({ success: false, message: 'User not authenticated' });
    return null;
  }
  return req.userId;
};

const sendRevisionConflict = (res: Response, currentRevision: number, message: string) =>
  res.status(409).json({
    success: false,
    message,
    currentRevision,
    currentPcrRevision: currentRevision,
  });

const isDraftStoreUnavailable = (error: unknown): boolean =>
  error instanceof DraftStoreUnavailableError || (error as { code?: string })?.code === 'DRAFT_STORE_UNAVAILABLE';

const sendDraftStoreUnavailable = (res: Response) =>
  res.status(503).json({
    success: false,
    code: 'DRAFT_STORE_UNAVAILABLE',
    message: 'PCR draft store unavailable',
  });

class PcrRevisionConflictError extends Error {
  currentRevision: number;

  constructor(currentRevision: number) {
    super('PCR revision conflict');
    this.name = 'PcrRevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

class PcrNotFoundError extends Error {
  constructor() {
    super('PCR not found');
    this.name = 'PcrNotFoundError';
  }
}

class PcrReadyError extends Error {
  currentRevision: number;

  constructor(currentRevision: number) {
    super('PCR is already ready for client viewing');
    this.name = 'PcrReadyError';
    this.currentRevision = currentRevision;
  }
}

const isSerializationConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

const isPcrAlreadyExists = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return target === 'campaignId' || (Array.isArray(target) && target.includes('campaignId'));
};

/**
 * GET /api/campaign/:campaignId/pcr
 * Get PCR (Post Campaign Report) data for a specific campaign
 */
export const getPCRData = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, isPCRReady: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Keep an unreleased PCR indistinguishable from a missing report for
    // clients. Campaign access is enforced by middleware before this handler.
    const user = req.userId
      ? await prisma.user.findUnique({
          where: { id: req.userId },
          select: { role: true },
        })
      : null;

    if (user?.role === 'client' && !campaign.isPCRReady) {
      return res.status(404).json({
        success: false,
        message: 'PCR not found',
      });
    }

    // Get PCR data for this campaign
    const pcrData = await prisma.campaignPCR.findUnique({
      where: { campaignId },
    });

    if (!pcrData) {
      // Return empty/default structure if no PCR data exists yet
      return res.status(200).json({
        success: true,
        data: {
          campaignId,
          campaignName: campaign.name,
          content: null,
          revision: null,
          isPCRReady: campaign.isPCRReady,
          message: 'No PCR data found for this campaign',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        campaignId: pcrData.campaignId,
        campaignName: campaign.name,
        content: pcrData.content,
        updatedAt: pcrData.updatedAt,
        revision: pcrData.revision,
        isPCRReady: campaign.isPCRReady,
      },
    });
  } catch (error: any) {
    console.error('Error fetching PCR data:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch PCR data',
      error: error.message,
    });
  }
};

/**
 * POST /api/campaign/:campaignId/pcr/generate
 * Create the first saved PCR. The legacy POST remains an upsert for now.
 */
export const generatePCRData = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { content } = req.body ?? {};

    if (!isJsonObject(content)) {
      return res.status(400).json({
        success: false,
        message: 'Content must be a JSON object',
      });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, isPCRReady: true },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const pcrData = await prisma.campaignPCR.create({
      data: { campaignId, content: content as any },
    });

    return res.status(201).json({
      success: true,
      message: 'PCR data generated successfully',
      data: {
        campaignId: pcrData.campaignId,
        campaignName: campaign.name,
        content: pcrData.content,
        updatedAt: pcrData.updatedAt,
        revision: pcrData.revision,
        isPCRReady: campaign.isPCRReady,
      },
    });
  } catch (error: unknown) {
    if (isPcrAlreadyExists(error)) {
      return res.status(409).json({
        success: false,
        code: 'PCR_ALREADY_EXISTS',
        message: 'PCR already exists for this campaign',
      });
    }

    console.error('Error generating PCR data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate PCR data',
    });
  }
};

/**
 * POST /api/campaign/:campaignId/pcr
 * Save/Update PCR data for a specific campaign
 */
export const savePCRData = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
      });
    }

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, isPCRReady: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Upsert PCR data (create or update)
    const pcrData = await prisma.campaignPCR.upsert({
      where: { campaignId },
      update: {
        content,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
      create: {
        campaignId,
        content,
      },
    });

    // An explicit Save supersedes any autosave draft. Clearing it stops the old
    // draft from winning the newer-timestamp comparison on the next page load.
    await deleteDraft(campaignId);

    return res.status(200).json({
      success: true,
      message: 'PCR data saved successfully',
      data: {
        campaignId: pcrData.campaignId,
        campaignName: campaign.name,
        content: pcrData.content,
        updatedAt: pcrData.updatedAt,
        revision: pcrData.revision,
        isPCRReady: campaign.isPCRReady,
      },
    });
  } catch (error: any) {
    console.error('Error saving PCR data:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to save PCR data',
      error: error.message,
    });
  }
};

/**
 * PUT /api/campaign/:campaignId/pcr
 * Versioned PCR save. Unlike the legacy POST, this cannot create a report.
 */
export const saveVersionedPCRData = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { content, expectedPcrRevision, editorSessionId } = req.body ?? {};
    const expectedDraftRevision = req.body?.expectedDraftRevision ?? req.body?.draftRevision;

    if (expectedPcrRevision === undefined || expectedPcrRevision === null) {
      return res.status(428).json({
        success: false,
        message: 'expectedPcrRevision is required',
      });
    }

    if (!isPositiveInteger(expectedPcrRevision)) {
      return res.status(400).json({
        success: false,
        message: 'expectedPcrRevision must be a positive integer',
      });
    }

    if (!isJsonObject(content)) {
      return res.status(400).json({
        success: false,
        message: 'Content must be a JSON object',
      });
    }

    if (editorSessionId !== undefined && (!editorSessionId || !isValidEditorSessionId(editorSessionId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid editor session ID',
      });
    }

    if (expectedDraftRevision !== undefined && !isPositiveInteger(expectedDraftRevision)) {
      return res.status(400).json({
        success: false,
        message: 'expectedDraftRevision must be a positive integer',
      });
    }

    if (expectedDraftRevision !== undefined && editorSessionId === undefined) {
      return res.status(400).json({
        success: false,
        message: 'editorSessionId is required with expectedDraftRevision',
      });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, isPCRReady: true },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const existing = await prisma.campaignPCR.findUnique({
      where: { campaignId },
      select: { revision: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'PCR not found' });
    }

    const updated = await prisma.campaignPCR.updateMany({
      where: { campaignId, revision: expectedPcrRevision },
      data: {
        content: content as any,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      const current = await prisma.campaignPCR.findUnique({
        where: { campaignId },
        select: { revision: true },
      });

      if (!current) {
        return res.status(404).json({ success: false, message: 'PCR not found' });
      }

      return sendRevisionConflict(res, current.revision, 'PCR revision conflict');
    }

    const pcrData = await prisma.campaignPCR.findUnique({ where: { campaignId } });
    if (!pcrData) {
      return res.status(404).json({ success: false, message: 'PCR not found' });
    }

    let draftCleared = false;
    if (editorSessionId !== undefined && expectedDraftRevision !== undefined && req.userId) {
      try {
        const deleted = await deleteSessionDraft(req.userId, campaignId, editorSessionId, expectedDraftRevision);
        draftCleared = deleted.deleted;
      } catch (error) {
        if (!isDraftStoreUnavailable(error)) throw error;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'PCR data saved successfully',
      data: {
        campaignId: pcrData.campaignId,
        campaignName: campaign.name,
        content: pcrData.content,
        updatedAt: pcrData.updatedAt,
        revision: pcrData.revision,
        isPCRReady: campaign.isPCRReady,
        draftCleared,
      },
    });
  } catch (error: any) {
    console.error('Error saving versioned PCR data:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to save PCR data',
      error: error.message,
    });
  }
};

/**
 * GET /api/campaign/:campaignId/pcr/draft
 * Read the autosave draft plus the saved report's updatedAt, so the browser can
 * decide which one is newer in a single round trip.
 */
export const getPCRDraft = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    const [draft, pcrData] = await Promise.all([
      getDraft(campaignId),
      prisma.campaignPCR.findUnique({
        where: { campaignId },
        select: { updatedAt: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        draft,
        pcrUpdatedAt: pcrData?.updatedAt ?? null,
      },
    });
  } catch (error: any) {
    console.error('Error fetching PCR draft:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch PCR draft',
      error: error.message,
    });
  }
};

/**
 * PUT /api/campaign/:campaignId/pcr/draft
 * Autosave endpoint. Called often, so the response stays small.
 */
export const savePCRDraft = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
      });
    }

    const savedAt = await setDraft(campaignId, content, req.userId ?? null);

    if (!savedAt) {
      return res.status(503).json({
        success: false,
        message: 'Draft store unavailable',
      });
    }

    return res.status(200).json({ success: true, savedAt });
  } catch (error: any) {
    console.error('Error saving PCR draft:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to save PCR draft',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/campaign/:campaignId/pcr/draft
 */
export const deletePCRDraft = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    await deleteDraft(campaignId);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error deleting PCR draft:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete PCR draft',
      error: error.message,
    });
  }
};

/**
 * POST /api/campaign/:campaignId/pcr/flush
 * Periodic checkpoint: copy the Redis draft into CampaignPCR.content.
 * Silent by design - the editor keeps its edit mode and undo history.
 */
export const flushPCRDraft = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const result = await flushDraftToDb(campaignId);

    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error('Error flushing PCR draft:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to flush PCR draft',
      error: error.message,
    });
  }
};

/**
 * GET /api/campaign/:campaignId/pcr/drafts/:editorSessionId
 */
export const getPCRSessionDraft = async (req: Request, res: Response) => {
  try {
    const userId = getRequiredUserId(req, res);
    if (!userId) return;

    const editorSessionId = getEditorSessionId(req, res);
    if (!editorSessionId) return;

    const { campaignId } = req.params;
    const [draft, pcrData] = await Promise.all([
      getSessionDraft(userId, campaignId, editorSessionId),
      prisma.campaignPCR.findUnique({
        where: { campaignId },
        select: { revision: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        draft,
        pcrRevision: pcrData?.revision ?? null,
      },
    });
  } catch (error: any) {
    console.error('Error fetching PCR session draft:', error.message);
    if (isDraftStoreUnavailable(error)) return sendDraftStoreUnavailable(res);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch PCR draft',
      error: error.message,
    });
  }
};

/**
 * PUT /api/campaign/:campaignId/pcr/drafts/:editorSessionId
 */
export const savePCRSessionDraft = async (req: Request, res: Response) => {
  try {
    const userId = getRequiredUserId(req, res);
    if (!userId) return;

    const editorSessionId = getEditorSessionId(req, res);
    if (!editorSessionId) return;

    const { campaignId } = req.params;
    const { content, draftRevision, basePcrRevision } = req.body ?? {};

    if (draftRevision === undefined || basePcrRevision === undefined) {
      return res.status(428).json({
        success: false,
        message: 'draftRevision and basePcrRevision are required',
      });
    }

    if (!isPositiveInteger(draftRevision) || !isPositiveInteger(basePcrRevision)) {
      return res.status(400).json({
        success: false,
        message: 'draftRevision and basePcrRevision must be positive integers',
      });
    }

    if (!isJsonObject(content)) {
      return res.status(400).json({
        success: false,
        message: 'Content must be a JSON object',
      });
    }

    const pcrData = await prisma.campaignPCR.findUnique({
      where: { campaignId },
      select: { revision: true },
    });

    if (!pcrData) {
      return res.status(404).json({ success: false, message: 'PCR not found' });
    }

    if (pcrData.revision !== basePcrRevision) {
      return sendRevisionConflict(res, pcrData.revision, 'PCR revision conflict');
    }

    const result = await setSessionDraft(userId, campaignId, editorSessionId, content, draftRevision, basePcrRevision);

    if (!result.saved) {
      const current = result.current;
      return res.status(409).json({
        success: false,
        message: 'Draft revision conflict',
        currentDraftRevision: current?.draftRevision ?? null,
        currentPcrRevision: pcrData.revision,
      });
    }

    return res.status(200).json({ success: true, data: { draft: result.current } });
  } catch (error: any) {
    console.error('Error saving PCR session draft:', error.message);
    if (isDraftStoreUnavailable(error)) return sendDraftStoreUnavailable(res);
    return res.status(500).json({
      success: false,
      message: 'Failed to save PCR draft',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/campaign/:campaignId/pcr/drafts/:editorSessionId
 */
export const deletePCRSessionDraft = async (req: Request, res: Response) => {
  try {
    const userId = getRequiredUserId(req, res);
    if (!userId) return;

    const editorSessionId = getEditorSessionId(req, res);
    if (!editorSessionId) return;

    const queryDraftRevision = req.query.expectedDraftRevision;
    const rawDraftRevision = Array.isArray(queryDraftRevision)
      ? queryDraftRevision
      : (queryDraftRevision ?? req.body?.expectedDraftRevision ?? req.body?.draftRevision);
    const expectedDraftRevision = typeof rawDraftRevision === 'string' ? Number(rawDraftRevision) : rawDraftRevision;
    if (expectedDraftRevision === undefined || expectedDraftRevision === null) {
      return res.status(428).json({
        success: false,
        message: 'expectedDraftRevision is required',
      });
    }

    if (!isPositiveInteger(expectedDraftRevision)) {
      return res.status(400).json({
        success: false,
        message: 'expectedDraftRevision must be a positive integer',
      });
    }

    const { campaignId } = req.params;
    const result = await deleteSessionDraft(userId, campaignId, editorSessionId, expectedDraftRevision);

    if (result.deleted) {
      return res.status(204).send();
    }

    if (!result.current) {
      return res.status(204).send();
    }

    return res.status(409).json({
      success: false,
      message: 'Draft revision conflict',
      currentDraftRevision: result.current.draftRevision,
    });
  } catch (error: any) {
    console.error('Error deleting PCR session draft:', error.message);
    if (isDraftStoreUnavailable(error)) return sendDraftStoreUnavailable(res);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete PCR draft',
      error: error.message,
    });
  }
};

/**
 * POST /api/campaign/:campaignId/pcr/drafts/:editorSessionId/flush
 */
const flushSessionPcrInTransaction = async (
  campaignId: string,
  draft: SessionPcrDraft,
  expectedDraftRevision: number,
  expectedPcrRevision: number,
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          if (draft.draftRevision !== expectedDraftRevision || draft.basePcrRevision !== expectedPcrRevision) {
            throw new PcrRevisionConflictError(expectedPcrRevision);
          }

          const pcrData = await tx.campaignPCR.findUnique({
            where: { campaignId },
            select: { revision: true, campaign: { select: { isPCRReady: true } } },
          });

          if (!pcrData) throw new PcrNotFoundError();
          if (pcrData.revision !== expectedPcrRevision) {
            throw new PcrRevisionConflictError(pcrData.revision);
          }
          if (pcrData.campaign.isPCRReady) throw new PcrReadyError(pcrData.revision);

          const updatedAt = new Date();
          const updated = await tx.campaignPCR.updateMany({
            where: { campaignId, revision: expectedPcrRevision },
            data: {
              content: draft.content as any,
              revision: { increment: 1 },
              updatedAt,
            },
          });

          if (updated.count !== 1) throw new PcrRevisionConflictError(pcrData.revision);

          return {
            revision: expectedPcrRevision + 1,
            updatedAt,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 1000,
          timeout: 3000,
        },
      );
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error('PCR flush retry limit reached');
};

export const flushPCRSessionDraft = async (req: Request, res: Response) => {
  try {
    const userId = getRequiredUserId(req, res);
    if (!userId) return;

    const editorSessionId = getEditorSessionId(req, res);
    if (!editorSessionId) return;

    const { campaignId } = req.params;
    const { expectedDraftRevision, expectedPcrRevision } = req.body ?? {};

    if (expectedDraftRevision === undefined || expectedPcrRevision === undefined) {
      return res.status(428).json({
        success: false,
        message: 'expectedDraftRevision and expectedPcrRevision are required',
      });
    }

    if (!isPositiveInteger(expectedDraftRevision) || !isPositiveInteger(expectedPcrRevision)) {
      return res.status(400).json({
        success: false,
        message: 'expectedDraftRevision and expectedPcrRevision must be positive integers',
      });
    }

    const draft = await getSessionDraft(userId, campaignId, editorSessionId);
    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    if (draft.draftRevision !== expectedDraftRevision) {
      return res.status(409).json({
        success: false,
        message: 'Draft revision conflict',
        currentDraftRevision: draft.draftRevision,
        currentPcrRevision: draft.basePcrRevision,
      });
    }

    if (draft.basePcrRevision !== expectedPcrRevision) {
      return res.status(409).json({
        success: false,
        message: 'PCR revision conflict',
        currentDraftRevision: draft.draftRevision,
        currentPcrRevision: draft.basePcrRevision,
      });
    }

    const saved = await flushSessionPcrInTransaction(campaignId, draft, expectedDraftRevision, expectedPcrRevision);

    let draftRebased = false;
    try {
      draftRebased = await rebaseSessionDraft(
        userId,
        campaignId,
        editorSessionId,
        expectedDraftRevision,
        saved.revision,
      );
    } catch (error) {
      if (!isDraftStoreUnavailable(error)) throw error;
    }

    return res.status(200).json({
      success: true,
      data: {
        flushed: true,
        pcrRevision: saved.revision,
        updatedAt: saved.updatedAt,
        draftRevision: expectedDraftRevision,
        draftRebased,
      },
    });
  } catch (error: any) {
    console.error('Error flushing PCR session draft:', error.message);
    if (isDraftStoreUnavailable(error)) return sendDraftStoreUnavailable(res);
    if (error instanceof PcrRevisionConflictError) {
      return sendRevisionConflict(res, error.currentRevision, error.message);
    }
    if (error instanceof PcrNotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error instanceof PcrReadyError) {
      return res.status(409).json({
        success: false,
        message: error.message,
        currentRevision: error.currentRevision,
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to flush PCR draft',
      error: error.message,
    });
  }
};
