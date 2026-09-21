import { promises as fs } from 'fs';
import { Request, Response } from 'express';

import { TreasureHuntError } from '../service/treasureHuntService';

const CAPTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

/**
 * The auto-captured scan photo is a nice-to-have, never a precondition: the
 * claim and its XP must land even when the upload is missing, oversized or
 * unreadable. Anything suspect is dropped and the collection falls back to the
 * canonical location artwork, which is exactly what the service already does
 * when no capture is supplied.
 */
const readCapture = async (req: Request) => {
  const raw = (req.files as any)?.capture;

  // Dropping the photo is silent by design, which makes "why is there no photo?"
  // impossible to answer after the fact — so every discard says why.
  if (!raw) {
    if (req.body?.source === 'IN_APP_CAMERA') {
      console.warn(
        '[hunt] no capture part in redeem request',
        JSON.stringify({ fileFields: Object.keys((req.files as any) ?? {}) }),
      );
    }
    return undefined;
  }

  const file = Array.isArray(raw) ? raw[0] : raw;

  if (!CAPTURE_TYPES.has(file?.mimetype)) {
    console.warn('[hunt] capture rejected: unsupported type', file?.mimetype);
    return undefined;
  }
  if (file?.size > MAX_CAPTURE_BYTES) {
    console.warn('[hunt] capture rejected: too large', file?.size);
    return undefined;
  }

  try {
    // express-fileupload runs with useTempFiles, so the bytes are on disk
    // rather than in file.data.
    const data = file.tempFilePath ? await fs.readFile(file.tempFilePath) : file.data;
    if (!data?.length) {
      console.warn('[hunt] capture rejected: empty file', file?.tempFilePath);
      return undefined;
    }
    return { data, contentType: file.mimetype };
  } catch (error) {
    console.warn('[hunt] capture unreadable', (error as Error)?.message);
    return undefined;
  }
};

const sendError = (res: Response, error: unknown) => {
  if (error instanceof TreasureHuntError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Unable to process the treasure hunt request.',
  });
};

export const createTreasureHuntController = ({ service }: { service: any }) => ({
  async redeem(req: Request, res: Response) {
    try {
      const result = await service.redeem({
        userId: req.userId,
        scanValue: req.body.scanValue,
        source: req.body.source,
        capture: await readCapture(req),
      });

      return res.status(result.outcome === 'claimed' ? 201 : 200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async preview(req: Request, res: Response) {
    try {
      const data = await service.preview({ token: req.body.token });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async getFeatured(req: Request, res: Response) {
    try {
      const data = await service.getFeatured({ userId: req.userId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async list(req: Request, res: Response) {
    try {
      const data = await service.list({ userId: req.userId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async getDetail(req: Request, res: Response) {
    try {
      const data = await service.getDetail({
        userId: req.userId,
        huntId: req.params.huntId,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async getCapture(req: Request, res: Response) {
    try {
      const url = await service.getCaptureUrl({
        userId: req.userId,
        claimId: req.params.claimId,
      });
      return res.redirect(302, url);
    } catch (error) {
      return sendError(res, error);
    }
  },

  /**
   * Same audited access as getCapture, but hands back the signed URL as JSON.
   * The admin table needs it this way: following the 302 from a browser request
   * that carries an auth header re-sends that header to storage.googleapis.com
   * and trips CORS, whereas a signed URL in an <img> needs no header at all.
   */
  async getCaptureUrl(req: Request, res: Response) {
    try {
      const url = await service.getCaptureUrl({
        userId: req.userId,
        claimId: req.params.claimId,
      });
      return res.status(200).json({ success: true, data: { url } });
    } catch (error) {
      return sendError(res, error);
    }
  },
});
