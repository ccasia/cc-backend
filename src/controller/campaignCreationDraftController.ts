import { Request, Response } from 'express';
import { UploadedFile } from 'express-fileupload';
import { z } from 'zod';

import {
  getCampaignCreationDraft,
  createCampaignCreationDraft as createDraft,
  updateCampaignCreationDraft as updateDraft,
  deleteCampaignCreationDraft as deleteDraft,
  uploadCampaignCreationDraftFile as uploadDraftFile,
} from '@services/campaignCreationDraftService';

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const draftBodySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.json()),
    activeStep: z.number().int().nonnegative(),
    showAdditionalDetails: z.boolean(),
  })
  .strict();
const idSchema = z.uuid();
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export const createCampaignCreationDraft = async (req: Request, res: Response) => {
  try {
    const draft = await createDraft(req.userId!);
    return res.status(200).json({ draft });
  } catch (error) {
    console.error('Failed to create campaign creation draft:', error);
    return res.status(500).json({ draft: null });
  }
};

export const getActiveCampaignCreationDraft = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ draft: await getCampaignCreationDraft(req.userId!) });
  } catch (error) {
    console.error('Failed to get campaign creation draft:', error);
    return res.status(500).json({ draft: null });
  }
};

export const updateCampaignCreationDraft = async (req: Request, res: Response) => {
  const id = idSchema.safeParse(req.params.id);
  const body = draftBodySchema.safeParse(req.body);
  if (
    !id.success ||
    !body.success ||
    Buffer.byteLength(JSON.stringify(body.data.payload), 'utf8') > MAX_PAYLOAD_BYTES
  ) {
    return res.status(400).json({ draft: null });
  }

  try {
    const result = await updateDraft(
      req.userId!,
      id.data,
      body.data.revision,
      body.data.payload,
      body.data.activeStep,
      body.data.showAdditionalDetails,
    );
    if (result.status === 'not-found') return res.status(404).json({ draft: null });
    if (result.status === 'conflict') {
      return res.status(409).json({ code: 'DRAFT_REVISION_CONFLICT', draft: result.draft });
    }
    return res.status(200).json({ draft: result.draft });
  } catch (error) {
    console.error('Failed to update campaign creation draft:', error);
    return res.status(500).json({ draft: null });
  }
};

export const uploadCampaignCreationDraftFile = async (req: Request, res: Response) => {
  const id = idSchema.safeParse(req.params.id);
  const rawFile = (req.files as { file?: UploadedFile | UploadedFile[] } | undefined)?.file;
  const file = Array.isArray(rawFile) ? rawFile[0] : rawFile;

  if (
    !id.success ||
    !file ||
    !file.tempFilePath ||
    file.size > MAX_FILE_BYTES ||
    !ALLOWED_FILE_TYPES.has(file.mimetype)
  ) {
    return res.status(400).json({ file: null });
  }

  try {
    const url = await uploadDraftFile(req.userId!, id.data, file.tempFilePath, file.name);
    if (!url) return res.status(404).json({ file: null });

    return res.status(201).json({
      file: {
        draftFile: true,
        url,
        preview: url,
        name: file.name,
        type: file.mimetype,
        size: file.size,
      },
    });
  } catch (error) {
    console.error('Failed to upload campaign creation draft file:', error);
    return res.status(500).json({ file: null });
  }
};

export const deleteCampaignCreationDraft = async (req: Request, res: Response) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ draft: null });

  try {
    const draft = await deleteDraft(req.userId!, id.data);
    return res.status(200).json({ draft });
  } catch (error) {
    console.error('Failed to delete campaign creation draft:', error);
    return res.status(500).json({ draft: null });
  }
};
