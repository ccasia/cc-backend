import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import connection from '@configs/redis';
import {
  buildGcsPublicUrl,
  buildUniqueObjectName,
  deleteGcsObjectByPublicUrl,
  deleteGcsObjectsByPrefix,
  uploadImageToObjectPath,
} from '@configs/cloudStorage.config';
import { prisma } from '../prisma/prisma';

const DEFAULT_DRAFT_NAME = 'Untitled draft';

export interface CampaignCreationDraft {
  id: string;
  ownerId: string;
  name: string;
  payload: Record<string, unknown>;
  activeStep: number;
  showAdditionalDetails: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  legacyFileStorage: boolean;
}

type DraftUpdateResult =
  | { status: 'updated'; draft: CampaignCreationDraft }
  | { status: 'conflict'; draft: CampaignCreationDraft }
  | { status: 'not-found'; draft: null };

export class CampaignCreationDraftLockedError extends Error {
  constructor(message = 'Campaign creation draft is locked by an active upload or cleanup task') {
    super(message);
    this.name = 'CampaignCreationDraftLockedError';
  }
}

export class CampaignCreationDraftConflictError extends Error {
  constructor(message = 'Campaign creation draft revision changed or is no longer available') {
    super(message);
    this.name = 'CampaignCreationDraftConflictError';
  }
}

type DraftOperationResult =
  | { status: 'ready'; draft: CampaignCreationDraft; legacyFileStorage: boolean }
  | { status: 'locked'; draft: null }
  | { status: 'not-found'; draft: null };

type DraftDeleteResult =
  | { status: 'deleted'; draft: CampaignCreationDraft }
  | { status: 'locked'; draft: null }
  | { status: 'not-found'; draft: null };

interface DraftRecord {
  id: string;
  ownerId: string;
  name: string;
  payload: Prisma.JsonValue;
  activeStep: number;
  showAdditionalDetails: boolean;
  revision: number;
  legacyFileStorage: boolean;
  filesCleanupPending: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const legacyRedisKey = (ownerId: string) => `campaign-creation-draft:v1:${ownerId}`;
const draftUploadFolder = (ownerId: string, draftId: string) => `campaign-creation-drafts/${ownerId}/${draftId}`;
export const getCampaignCreationDraftUploadPrefix = (ownerId: string, draftId: string) =>
  `https://storage.googleapis.com/${process.env.BUCKET_NAME}/campaign-creation-drafts/${encodeURIComponent(
    ownerId,
  )}/${encodeURIComponent(draftId)}/`;

export const getLegacyCampaignCreationDraftUploadPrefix = (ownerId: string) =>
  `https://storage.googleapis.com/${process.env.BUCKET_NAME}/campaign-creation-drafts/${encodeURIComponent(ownerId)}/`;

const getDraftName = (payload: Record<string, unknown>) => {
  const campaignName = payload.campaignName;
  return typeof campaignName === 'string' && campaignName.trim() ? campaignName.trim() : DEFAULT_DRAFT_NAME;
};

const toDraft = (draft: DraftRecord): CampaignCreationDraft => ({
  id: draft.id,
  ownerId: draft.ownerId,
  name: draft.name,
  payload: (draft.payload as Record<string, unknown>) || {},
  activeStep: draft.activeStep,
  showAdditionalDetails: draft.showAdditionalDetails,
  revision: draft.revision,
  createdAt: draft.createdAt.toISOString(),
  updatedAt: draft.updatedAt.toISOString(),
  legacyFileStorage: draft.legacyFileStorage,
});

const toValidDate = (value: unknown, fallback: Date) => {
  const date = new Date(typeof value === 'string' || value instanceof Date ? value : '');
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const parseLegacyDraft = (raw: string, ownerId: string): Prisma.CampaignCreationDraftCreateInput | null => {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const payload =
      value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
        ? (value.payload as Record<string, unknown>)
        : {};
    const id = typeof value.id === 'string' && value.id ? value.id : null;
    if (!id) return null;

    const now = new Date();
    return {
      id,
      owner: { connect: { id: ownerId } },
      name: getDraftName(payload),
      payload: payload as Prisma.InputJsonValue,
      activeStep:
        Number.isInteger(value.activeStep) && (value.activeStep as number) >= 0 ? (value.activeStep as number) : 0,
      showAdditionalDetails: value.showAdditionalDetails === true,
      revision: Number.isInteger(value.revision) && (value.revision as number) >= 0 ? (value.revision as number) : 0,
      legacyFileStorage: true,
      createdAt: toValidDate(value.createdAt, now),
      updatedAt: toValidDate(value.updatedAt, now),
    };
  } catch (error) {
    console.error('Failed to parse legacy campaign creation draft:', error);
    return null;
  }
};

const migrateLegacyDraft = async (ownerId: string) => {
  const key = legacyRedisKey(ownerId);
  const raw = await connection.get(key);
  if (!raw) return;

  const data = parseLegacyDraft(raw, ownerId);
  if (!data) return;

  let durable = await prisma.campaignCreationDraft.findUnique({ where: { id: data.id } });
  if (!durable) {
    try {
      durable = await prisma.campaignCreationDraft.create({ data });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      durable = await prisma.campaignCreationDraft.findUnique({ where: { id: data.id } });
    }
  }

  if (durable?.ownerId === ownerId) {
    // Redis is removed only after the database row is confirmed durable.
    try {
      await connection.del(key);
    } catch (error) {
      console.error('Failed to remove migrated campaign creation draft from Redis:', error);
    }
  }
};

const getDraftRecord = async (ownerId: string, draftId: string) =>
  prisma.campaignCreationDraft.findFirst({ where: { id: draftId, ownerId } });

const getUsableDraftRecord = async (ownerId: string, draftId: string) =>
  prisma.campaignCreationDraft.findFirst({
    where: { id: draftId, ownerId, filesCleanupPending: false },
  });

const UPLOAD_LEASE_MS = 60 * 60 * 1000;

const clearExpiredUploadLeases = async (ownerId: string, draftId: string) => {
  const now = new Date();
  const expiredLeases = await prisma.campaignCreationDraftUploadLease.findMany({
    where: { ownerId, draftId, expiresAt: { lte: now } },
  });

  for (const lease of expiredLeases) {
    if (lease.objectUrl) {
      try {
        await deleteGcsObjectByPublicUrl(lease.objectUrl);
      } catch (error) {
        console.error('Failed to clean an expired campaign creation draft upload lease:', error);
        return false;
      }
    }

    await prisma.campaignCreationDraftUploadLease.deleteMany({ where: { id: lease.id } });
  }

  return true;
};

const lockDraftRow = async (tx: any, ownerId: string, draftId: string) => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "CampaignCreationDraft"
    WHERE "id" = ${draftId} AND "ownerId" = ${ownerId}
    FOR UPDATE
  `;
  return rows.length === 1;
};

const acquireDraftUploadLease = async (ownerId: string, draftId: string, objectUrl: string) => {
  if (!(await clearExpiredUploadLeases(ownerId, draftId))) return null;

  return prisma.$transaction(async (tx: any) => {
    if (!(await lockDraftRow(tx, ownerId, draftId))) return null;

    const draft = await tx.campaignCreationDraft.findFirst({
      where: { id: draftId, ownerId, filesCleanupPending: false },
    });
    if (!draft) return null;

    await tx.campaignCreationDraftUploadLease.deleteMany({
      where: { draftId, ownerId, expiresAt: { lte: new Date() }, objectUrl: null },
    });

    const activeLease = await tx.campaignCreationDraftUploadLease.findFirst({
      where: {
        draftId,
        ownerId,
        OR: [{ cleanupPending: true }, { releasedAt: null, expiresAt: { gt: new Date() } }],
      },
    });
    if (activeLease) return null;

    const lease = await tx.campaignCreationDraftUploadLease.create({
      data: {
        draft: { connect: { id: draftId } },
        owner: { connect: { id: ownerId } },
        expiresAt: new Date(Date.now() + UPLOAD_LEASE_MS),
        objectUrl,
      },
    });
    return lease.id;
  });
};

const releaseDraftUploadLease = async (leaseId: string, cleanupPending: boolean) => {
  if (cleanupPending) {
    const released = await prisma.campaignCreationDraftUploadLease.updateMany({
      where: { id: leaseId, releasedAt: null },
      data: { cleanupPending: true, releasedAt: new Date(), expiresAt: new Date() },
    });
    return released.count === 1;
  }

  const released = await prisma.campaignCreationDraftUploadLease.deleteMany({
    where: { id: leaseId, releasedAt: null },
  });
  return released.count === 1;
};

const getDraftOperationState = async (
  ownerId: string,
  draftId: string,
  allowCleanupPending: boolean,
): Promise<DraftOperationResult> => {
  if (!(await clearExpiredUploadLeases(ownerId, draftId))) return { status: 'locked', draft: null };

  const activeLease = await prisma.campaignCreationDraftUploadLease.findFirst({
    where: {
      draftId,
      ownerId,
      OR: [{ cleanupPending: true }, { releasedAt: null, expiresAt: { gt: new Date() } }],
    },
  });
  if (activeLease) return { status: 'locked', draft: null };

  const draft = await getDraftRecord(ownerId, draftId);
  if (!draft) return { status: 'not-found', draft: null };
  if (draft.filesCleanupPending && !allowCleanupPending) return { status: 'locked', draft: null };

  return { status: 'ready', draft: toDraft(draft), legacyFileStorage: draft.legacyFileStorage };
};

export const listCampaignCreationDrafts = async (ownerId: string) => {
  await migrateLegacyDraft(ownerId);
  const drafts = await prisma.campaignCreationDraft.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
  });

  return drafts.map(toDraft);
};

export const getLatestCampaignCreationDraft = async (ownerId: string) => {
  await migrateLegacyDraft(ownerId);
  const draft = await prisma.campaignCreationDraft.findFirst({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
  });

  return draft ? toDraft(draft) : null;
};

export const getCampaignCreationDraft = async (ownerId: string, draftId: string) => {
  await migrateLegacyDraft(ownerId);
  const draft = await getDraftRecord(ownerId, draftId);
  return draft ? toDraft(draft) : null;
};

export const getCampaignCreationDraftForCampaign = async (ownerId: string, draftId: string) => {
  await migrateLegacyDraft(ownerId);
  return getDraftOperationState(ownerId, draftId, false);
};

export const createCampaignCreationDraft = async (ownerId: string) => {
  const draft = await prisma.campaignCreationDraft.create({
    data: {
      id: uuidv4(),
      ownerId,
      name: DEFAULT_DRAFT_NAME,
      payload: {},
      activeStep: 0,
      showAdditionalDetails: false,
      revision: 0,
    },
  });

  return toDraft(draft);
};

export const uploadCampaignCreationDraftFile = async (
  ownerId: string,
  draftId: string,
  tempFilePath: string,
  fileName: string,
) => {
  await migrateLegacyDraft(ownerId);
  const objectPath = `${draftUploadFolder(ownerId, draftId)}/${buildUniqueObjectName(fileName)}`;
  const objectUrl = buildGcsPublicUrl(process.env.BUCKET_NAME as string, objectPath);
  const leaseId = await acquireDraftUploadLease(ownerId, draftId, objectUrl);
  if (!leaseId) return null;

  let uploadedUrl: string | null = objectUrl;
  let uploadedObjectNeedsCleanup = false;
  let cleanupPending = false;
  let leaseReleaseError: unknown;
  const deleteUploadedObject = async () => {
    if (!uploadedUrl) return true;
    try {
      await deleteGcsObjectByPublicUrl(uploadedUrl);
      uploadedObjectNeedsCleanup = false;
      return true;
    } catch (error) {
      console.error('Failed to remove an orphaned campaign creation draft file:', error);
      return false;
    }
  };

  try {
    uploadedObjectNeedsCleanup = true;
    uploadedUrl = await uploadImageToObjectPath(tempFilePath, objectPath);

    const stillUsable = await getUsableDraftRecord(ownerId, draftId);
    if (!stillUsable) {
      cleanupPending = !(await deleteUploadedObject());
      return null;
    }
    uploadedObjectNeedsCleanup = false;
  } catch (error) {
    if (uploadedObjectNeedsCleanup) cleanupPending = !(await deleteUploadedObject());
    throw error;
  } finally {
    try {
      if (!(await releaseDraftUploadLease(leaseId, cleanupPending))) {
        leaseReleaseError = new Error('Campaign creation draft upload lease could not be released');
      }
    } catch (leaseError) {
      leaseReleaseError = leaseError;
    }
  }

  if (leaseReleaseError) throw leaseReleaseError;
  return uploadedUrl;
};

export const updateCampaignCreationDraft = async (
  ownerId: string,
  draftId: string,
  revision: number,
  payload: Record<string, unknown>,
  activeStep: number,
  showAdditionalDetails: boolean,
): Promise<DraftUpdateResult> => {
  await migrateLegacyDraft(ownerId);
  const updated = await prisma.campaignCreationDraft.updateMany({
    where: { id: draftId, ownerId, revision, filesCleanupPending: false },
    data: {
      name: getDraftName(payload),
      payload: payload as Prisma.InputJsonValue,
      activeStep,
      showAdditionalDetails,
      revision: { increment: 1 },
    },
  });

  const current = await getCampaignCreationDraft(ownerId, draftId);
  if (!current) return { status: 'not-found', draft: null };
  if (updated.count === 0) return { status: 'conflict', draft: current };
  return { status: 'updated', draft: current };
};

const deleteDraftFiles = async (ownerId: string, draftId: string) => {
  await deleteGcsObjectsByPrefix(`${draftUploadFolder(ownerId, draftId)}/`);
};

export const deleteCampaignCreationDraft = async (ownerId: string, draftId: string): Promise<DraftDeleteResult> => {
  await migrateLegacyDraft(ownerId);
  const state = await getDraftOperationState(ownerId, draftId, true);
  if (state.status !== 'ready') return { status: state.status, draft: null };

  const prepared = await prisma.$transaction(async (tx: any) => {
    if (!(await lockDraftRow(tx, ownerId, draftId))) return null;

    const now = new Date();
    const draft = await tx.campaignCreationDraft.findFirst({
      where: {
        id: draftId,
        ownerId,
        uploadLeases: {
          none: {
            OR: [{ cleanupPending: true }, { releasedAt: null, expiresAt: { gt: now } }],
          },
        },
      },
    });
    if (!draft) return null;

    if (draft.legacyFileStorage) {
      const deleted = await tx.campaignCreationDraft.deleteMany({ where: { id: draftId, ownerId } });
      return deleted.count === 1 ? { action: 'deleted', draft } : null;
    }

    if (draft.filesCleanupPending) return { action: 'cleanup', draft };

    const marked = await tx.campaignCreationDraft.updateMany({
      where: { id: draftId, ownerId, filesCleanupPending: false },
      data: { filesCleanupPending: true },
    });
    return marked.count === 1 ? { action: 'cleanup', draft } : null;
  });

  if (!prepared) return { status: 'locked', draft: null };
  if (prepared.action === 'deleted') return { status: 'deleted', draft: toDraft(prepared.draft) };

  // Clean the ID-scoped folder before deleting the row. A failure leaves the
  // row marked for a retry and never touches a shared legacy owner folder.
  await deleteDraftFiles(ownerId, draftId);

  const deleted = await prisma.campaignCreationDraft.deleteMany({
    where: { id: draftId, ownerId, filesCleanupPending: true },
  });
  if (deleted.count !== 1) return { status: 'locked', draft: null };
  return { status: 'deleted', draft: state.draft };
};
