import { Request, Response } from 'express';

import { uploadImage } from '../config/cloudStorage.config';
import { AdminValidationError, TreasureHuntAdminService } from '../service/treasureHuntAdminService';
import { BitlyError } from '../service/bitlyService';
import { toParticipantsCsv } from '../service/treasureHuntCsv';

const sendError = (res: Response, error: unknown) => {
  if (error instanceof AdminValidationError) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  if (error instanceof BitlyError) {
    const status = error.code === 'UPGRADE_REQUIRED' ? 402 : error.code === 'RATE_LIMITED' ? 429 : 503;
    return res.status(status).json({ success: false, code: error.code, message: error.message });
  }
  return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Unexpected error.' });
};

const parseDate = (value: unknown): Date | undefined =>
  value === undefined || value === null ? undefined : new Date(value as string);

const parseInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
};

// Artwork-carrying routes are multipart, so the JSON payload arrives as a string
// in the `data` field (the house convention — see bugController). Plain JSON
// requests still work.
const readBody = (req: Request): Record<string, any> => {
  const raw = (req.body ?? {}) as Record<string, any>;
  if (typeof raw.data !== 'string') return raw;
  try {
    return { ...raw, ...JSON.parse(raw.data) };
  } catch {
    throw new AdminValidationError('INVALID_PAYLOAD', 'Request payload is not valid JSON.');
  }
};

const ARTWORK_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
const ARTWORK_FOLDER = 'treasure-hunt-artwork';

// express-fileupload is registered globally (server.ts) with useTempFiles, so
// every uploaded file already has a tempFilePath by the time we get here.
const pickUploadedFile = (req: Request, field: string): any => {
  const raw = (req.files as any)?.[field];
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
};

const defaultUploadArtwork = async (file: any, prefix: string): Promise<string> => {
  const extension = ARTWORK_EXTENSIONS[String(file.mimetype).toLowerCase()];
  if (!extension) {
    throw new AdminValidationError('INVALID_ARTWORK_TYPE', 'Artwork must be a JPG, PNG, or WebP image.');
  }
  if (file.size > MAX_ARTWORK_BYTES) {
    throw new AdminValidationError('ARTWORK_TOO_LARGE', 'Artwork must be smaller than 5 MB.');
  }
  // Timestamped filenames so replacing artwork never serves a stale CDN copy.
  return uploadImage(file.tempFilePath, `${prefix}-${Date.now()}.${extension}`, ARTWORK_FOLDER);
};

export const createTreasureHuntAdminController = ({
  service,
  uploadArtwork = defaultUploadArtwork,
}: {
  service: TreasureHuntAdminService;
  uploadArtwork?: (file: any, prefix: string) => Promise<string>;
}) => ({
  async listHunts(_req: Request, res: Response) {
    try {
      const data = await service.listHunts();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async getHunt(req: Request, res: Response) {
    try {
      const data = await service.getHuntDetail({ huntId: req.params.huntId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async createHunt(req: Request, res: Response) {
    try {
      const data = await service.createHunt({
        actorUserId: req.userId as string,
        title: req.body.title,
        description: req.body.description,
        startsAt: parseDate(req.body.startsAt) as Date,
        endsAt: parseDate(req.body.endsAt) as Date,
        rewardXp: req.body.rewardXp,
        heroArtworkUrl: req.body.heroArtworkUrl,
      });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // The single Find Cipta event, created on first visit.
  async getCurrentHunt(req: Request, res: Response) {
    try {
      const data = await service.getCurrentHunt({ actorUserId: req.userId as string });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async updateHunt(req: Request, res: Response) {
    try {
      const body = readBody(req);
      const artwork = pickUploadedFile(req, 'artwork');
      const heroArtworkUrl = artwork ? await uploadArtwork(artwork, `${req.params.huntId}-hero`) : undefined;

      const data = await service.updateHunt({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        title: body.title,
        description: body.description,
        startsAt: parseDate(body.startsAt),
        endsAt: parseDate(body.endsAt),
        rewardXp: parseInteger(body.rewardXp),
        heroArtworkUrl,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async addLocation(req: Request, res: Response) {
    try {
      const body = readBody(req);
      const artwork = pickUploadedFile(req, 'artwork');
      if (!artwork) {
        throw new AdminValidationError('ARTWORK_REQUIRED', 'An artwork image is required for a location.');
      }
      const artworkUrl = await uploadArtwork(artwork, `${req.params.huntId}-location`);

      const data = await service.addLocation({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        name: body.name,
        hint: body.hint,
        artworkUrl,
      });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async updateLocation(req: Request, res: Response) {
    try {
      const body = readBody(req);
      const artwork = pickUploadedFile(req, 'artwork');
      const artworkUrl = artwork ? await uploadArtwork(artwork, req.params.locationId) : undefined;

      const data = await service.updateLocation({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        locationId: req.params.locationId,
        name: body.name,
        hint: body.hint,
        isEnabled: body.isEnabled === undefined ? undefined : body.isEnabled === true || body.isEnabled === 'true',
        artworkUrl,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async deleteLocation(req: Request, res: Response) {
    try {
      const data = await service.deleteLocation({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        locationId: req.params.locationId,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async reorderLocations(req: Request, res: Response) {
    try {
      const data = await service.reorderLocations({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        orderedIds: req.body?.orderedIds,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async publishQr(req: Request, res: Response) {
    try {
      const data = await service.publishLocationQr({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        locationId: req.params.locationId,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async publishHunt(req: Request, res: Response) {
    try {
      const data = await service.publishHunt({
        actorUserId: req.userId as string,
        huntId: req.params.huntId,
        feature: req.body?.feature,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async pauseHunt(req: Request, res: Response) {
    try {
      const data = await service.pauseHunt({ actorUserId: req.userId as string, huntId: req.params.huntId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async resumeHunt(req: Request, res: Response) {
    try {
      const data = await service.resumeHunt({ actorUserId: req.userId as string, huntId: req.params.huntId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async reactivateHunt(req: Request, res: Response) {
    try {
      const data = await service.reactivateHunt({ actorUserId: req.userId as string, huntId: req.params.huntId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async archiveHunt(req: Request, res: Response) {
    try {
      const data = await service.archiveHunt({ actorUserId: req.userId as string, huntId: req.params.huntId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async syncAnalytics(req: Request, res: Response) {
    try {
      await service.syncLocationAnalytics({ locationId: req.params.locationId });
      return res.status(200).json({ success: true });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async getDashboard(req: Request, res: Response) {
    try {
      const data = await service.getDashboard({ huntId: req.params.huntId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async getParticipants(req: Request, res: Response) {
    try {
      const data = await service.listParticipants({
        huntId: req.params.huntId,
        skip: req.query.skip ? Number(req.query.skip) : 0,
        take: req.query.take ? Number(req.query.take) : 25,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        locationId: typeof req.query.locationId === 'string' ? req.query.locationId : undefined,
        source: typeof req.query.source === 'string' ? req.query.source : undefined,
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
        sortOrder: typeof req.query.sortOrder === 'string' ? req.query.sortOrder : undefined,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async exportParticipants(req: Request, res: Response) {
    try {
      const rows = await service.getParticipantsForCsv({ huntId: req.params.huntId });
      const csv = toParticipantsCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="treasure-hunt-${req.params.huntId}-participants.csv"`,
      );
      return res.status(200).send(csv);
    } catch (error) {
      return sendError(res, error);
    }
  },
});
