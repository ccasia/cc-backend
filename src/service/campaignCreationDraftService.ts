import { v4 as uuidv4 } from 'uuid';

import connection from '@configs/redis';
import { uploadImage } from '@configs/cloudStorage.config';

export interface CampaignCreationDraft {
  id: string;
  ownerId: string;
  payload: Record<string, unknown>;
  activeStep: number;
  showAdditionalDetails: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

type DraftUpdateResult =
  | { status: 'updated'; draft: CampaignCreationDraft }
  | { status: 'conflict'; draft: CampaignCreationDraft }
  | { status: 'not-found'; draft: null };

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;
const configuredTtl = Number(process.env.REDIS_DRAFT_TTL_SECONDS);
const DRAFT_TTL_SECONDS =
  Number.isSafeInteger(configuredTtl) && configuredTtl > 0 ? configuredTtl : DEFAULT_TTL_SECONDS;
const keyFor = (ownerId: string) => `campaign-creation-draft:v1:${ownerId}`;

const UPDATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND'} end

local draft = cjson.decode(raw)
if draft.id ~= ARGV[1] then return {'NOT_FOUND'} end
if tonumber(draft.revision) ~= tonumber(ARGV[2]) then return {'CONFLICT', raw} end

draft.payload = cjson.decode(ARGV[3])
draft.activeStep = tonumber(ARGV[4])
draft.showAdditionalDetails = ARGV[5] == 'true'
draft.revision = tonumber(draft.revision) + 1
draft.updatedAt = ARGV[6]

local updated = cjson.encode(draft)
redis.call('SET', KEYS[1], updated, 'EX', ARGV[7])
return {'UPDATED', updated}
`;

const DELETE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND'} end

local draft = cjson.decode(raw)
if draft.id ~= ARGV[1] then return {'NOT_FOUND'} end

redis.call('DEL', KEYS[1])
return {'DELETED', raw}
`;

const parseDraft = (value: string | null): CampaignCreationDraft | null =>
  value ? (JSON.parse(value) as CampaignCreationDraft) : null;

export const getCampaignCreationDraft = async (ownerId: string) => parseDraft(await connection.get(keyFor(ownerId)));

export const createCampaignCreationDraft = async (ownerId: string) => {
  const existing = await getCampaignCreationDraft(ownerId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const draft: CampaignCreationDraft = {
    id: uuidv4(),
    ownerId,
    payload: {},
    activeStep: 0,
    showAdditionalDetails: false,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  const created = await connection.set(keyFor(ownerId), JSON.stringify(draft), 'EX', DRAFT_TTL_SECONDS, 'NX');

  if (created) return draft;
  return getCampaignCreationDraft(ownerId);
};

export const uploadCampaignCreationDraftFile = async (
  ownerId: string,
  draftId: string,
  tempFilePath: string,
  fileName: string,
) => {
  const draft = await getCampaignCreationDraft(ownerId);
  if (!draft || draft.id !== draftId) return null;

  return uploadImage(tempFilePath, fileName, `campaign-creation-drafts/${ownerId}`);
};

export const updateCampaignCreationDraft = async (
  ownerId: string,
  draftId: string,
  revision: number,
  payload: Record<string, unknown>,
  activeStep: number,
  showAdditionalDetails: boolean,
): Promise<DraftUpdateResult> => {
  const result = (await connection.eval(
    UPDATE_SCRIPT,
    1,
    keyFor(ownerId),
    draftId,
    revision,
    JSON.stringify(payload),
    activeStep,
    String(showAdditionalDetails),
    new Date().toISOString(),
    DRAFT_TTL_SECONDS,
  )) as [string, string?];

  if (result[0] === 'UPDATED') return { status: 'updated', draft: parseDraft(result[1]!)! };
  if (result[0] === 'CONFLICT') return { status: 'conflict', draft: parseDraft(result[1]!)! };
  return { status: 'not-found', draft: null };
};

export const deleteCampaignCreationDraft = async (ownerId: string, draftId: string) => {
  const result = (await connection.eval(DELETE_SCRIPT, 1, keyFor(ownerId), draftId)) as [string, string?];

  return result[0] === 'DELETED' ? parseDraft(result[1]!) : null;
};
