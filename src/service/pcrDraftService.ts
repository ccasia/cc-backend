import connection from '../config/redis';
import { prisma } from '../prisma/prisma';

// PCR autosave drafts live in Redis, keyed per campaign (shared between admins,
// same as the CampaignPCR row itself). Redis runs with maxmemory-policy
// noeviction, so every key we write MUST carry a TTL.
const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const draftKey = (campaignId: string) => `pcr:draft:${campaignId}`;

export interface PcrDraft {
  content: unknown;
  savedAt: string;
  savedBy: string | null;
}

export type FlushSkipReason = 'no_draft' | 'pcr_ready' | 'not_newer' | 'redis_unavailable';

export interface FlushResult {
  flushed: boolean;
  skipped?: FlushSkipReason;
  updatedAt?: Date;
}

/**
 * Read the draft for a campaign. Returns null when there is no draft, when the
 * stored value is unreadable, or when Redis is down — a Redis outage must never
 * break the PCR editor, the browser still holds its own localStorage copy.
 */
export const getDraft = async (campaignId: string): Promise<PcrDraft | null> => {
  try {
    const raw = await connection.get(draftKey(campaignId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.savedAt) return null;

    return parsed as PcrDraft;
  } catch (error: any) {
    console.error('PCR draft: failed to read draft:', error.message);
    return null;
  }
};

/**
 * Write the draft and refresh its TTL. Returns the savedAt stamp the browser
 * should keep, or null when the write failed.
 */
export const setDraft = async (campaignId: string, content: unknown, userId: string | null): Promise<string | null> => {
  const savedAt = new Date().toISOString();

  try {
    const payload: PcrDraft = { content, savedAt, savedBy: userId ?? null };
    await connection.set(draftKey(campaignId), JSON.stringify(payload), 'EX', DRAFT_TTL_SECONDS);
    return savedAt;
  } catch (error: any) {
    console.error('PCR draft: failed to write draft:', error.message);
    return null;
  }
};

export const deleteDraft = async (campaignId: string): Promise<void> => {
  try {
    await connection.del(draftKey(campaignId));
  } catch (error: any) {
    console.error('PCR draft: failed to delete draft:', error.message);
  }
};

/**
 * Push the Redis draft into CampaignPCR.content.
 *
 * Skips when the report is already marked ready for the client — the client
 * reads CampaignPCR.content directly, so a timed flush must not push
 * half-finished text in front of them. Only an explicit Save does that.
 *
 * The draft is intentionally NOT deleted: the user is still typing.
 */
export const flushDraftToDb = async (campaignId: string): Promise<FlushResult> => {
  const draft = await getDraft(campaignId);
  if (!draft) return { flushed: false, skipped: 'no_draft' };

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, isPCRReady: true },
  });

  if (!campaign) return { flushed: false, skipped: 'no_draft' };
  if (campaign.isPCRReady) return { flushed: false, skipped: 'pcr_ready' };

  const existing = await prisma.campaignPCR.findUnique({
    where: { campaignId },
    select: { updatedAt: true },
  });

  if (existing && new Date(draft.savedAt) <= existing.updatedAt) {
    return { flushed: false, skipped: 'not_newer', updatedAt: existing.updatedAt };
  }

  const saved = await prisma.campaignPCR.upsert({
    where: { campaignId },
    update: {
      content: draft.content as any,
      revision: { increment: 1 },
      updatedAt: new Date(),
    },
    create: { campaignId, content: draft.content as any },
  });

  return { flushed: true, updatedAt: saved.updatedAt };
};

export interface SessionPcrDraft {
  campaignId: string;
  editorSessionId: string;
  content: Record<string, unknown>;
  draftRevision: number;
  basePcrRevision: number;
  savedAt: string;
  savedBy: string;
}

export interface SessionDraftWriteResult {
  saved: boolean;
  current?: SessionPcrDraft | null;
}

export interface SessionDraftDeleteResult {
  deleted: boolean;
  current?: SessionPcrDraft | null;
}

export class DraftStoreUnavailableError extends Error {
  code = 'DRAFT_STORE_UNAVAILABLE';

  constructor(cause?: unknown) {
    super('PCR draft store unavailable');
    this.name = 'DraftStoreUnavailableError';
    if (cause) this.message = `PCR draft store unavailable: ${String(cause)}`;
  }
}

// Session IDs are part of a Redis key. Keep them opaque but restrict the
// alphabet and length so callers cannot alter the key namespace.
export const isValidEditorSessionId = (editorSessionId: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(editorSessionId);

const sessionDraftKey = (userId: string, campaignId: string, editorSessionId: string) =>
  `pcr:draft:${userId}:${campaignId}:${editorSessionId}`;

const SESSION_DRAFT_PUT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, parsed = pcall(cjson.decode, current)
  if ok and parsed and parsed.draftRevision and tonumber(parsed.draftRevision) >= tonumber(ARGV[1]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

const SESSION_DRAFT_DELETE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, parsed = pcall(cjson.decode, current)
if not ok or not parsed or parsed.savedBy ~= ARGV[1] then return -1 end
if not parsed.draftRevision or tonumber(parsed.draftRevision) ~= tonumber(ARGV[2]) then return -1 end
redis.call('DEL', KEYS[1])
return 1
`;

const SESSION_DRAFT_REBASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, parsed = pcall(cjson.decode, current)
if not ok or not parsed or parsed.savedBy ~= ARGV[1] then return 0 end
if not parsed.draftRevision or tonumber(parsed.draftRevision) ~= tonumber(ARGV[2]) then return 0 end
parsed.basePcrRevision = tonumber(ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(parsed), 'EX', ARGV[4])
return 1
`;

const parseSessionDraft = (
  raw: string | null,
  userId: string,
  campaignId: string,
  editorSessionId: string,
): SessionPcrDraft | null => {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const draft = parsed as Partial<SessionPcrDraft>;
  if (
    !draft.content ||
    typeof draft.content !== 'object' ||
    Array.isArray(draft.content) ||
    draft.campaignId !== campaignId ||
    draft.editorSessionId !== editorSessionId ||
    !Number.isInteger(draft.draftRevision) ||
    (draft.draftRevision as number) < 1 ||
    !Number.isInteger(draft.basePcrRevision) ||
    (draft.basePcrRevision as number) < 1 ||
    typeof draft.savedAt !== 'string' ||
    draft.savedBy !== userId
  ) {
    return null;
  }

  return {
    campaignId: draft.campaignId,
    editorSessionId: draft.editorSessionId,
    content: draft.content as Record<string, unknown>,
    draftRevision: draft.draftRevision as number,
    basePcrRevision: draft.basePcrRevision as number,
    savedAt: draft.savedAt,
    savedBy: draft.savedBy,
  };
};

export const getSessionDraft = async (
  userId: string,
  campaignId: string,
  editorSessionId: string,
): Promise<SessionPcrDraft | null> => {
  try {
    const raw = await connection.get(sessionDraftKey(userId, campaignId, editorSessionId));
    return parseSessionDraft(raw, userId, campaignId, editorSessionId);
  } catch (error) {
    throw new DraftStoreUnavailableError(error);
  }
};

export const setSessionDraft = async (
  userId: string,
  campaignId: string,
  editorSessionId: string,
  content: Record<string, unknown>,
  draftRevision: number,
  basePcrRevision: number,
): Promise<SessionDraftWriteResult> => {
  const draft: SessionPcrDraft = {
    campaignId,
    editorSessionId,
    content,
    draftRevision,
    basePcrRevision,
    savedAt: new Date().toISOString(),
    savedBy: userId,
  };
  const key = sessionDraftKey(userId, campaignId, editorSessionId);
  try {
    const result = await connection.eval(
      SESSION_DRAFT_PUT_SCRIPT,
      1,
      key,
      String(draftRevision),
      JSON.stringify(draft),
      String(DRAFT_TTL_SECONDS),
    );

    if (Number(result) === 1) return { saved: true, current: draft };
    return { saved: false, current: await getSessionDraft(userId, campaignId, editorSessionId) };
  } catch (error) {
    if (error instanceof DraftStoreUnavailableError) throw error;
    throw new DraftStoreUnavailableError(error);
  }
};

export const deleteSessionDraft = async (
  userId: string,
  campaignId: string,
  editorSessionId: string,
  expectedDraftRevision: number,
): Promise<SessionDraftDeleteResult> => {
  try {
    const result = await connection.eval(
      SESSION_DRAFT_DELETE_SCRIPT,
      1,
      sessionDraftKey(userId, campaignId, editorSessionId),
      userId,
      String(expectedDraftRevision),
    );

    if (Number(result) === 1) return { deleted: true };
    return { deleted: false, current: await getSessionDraft(userId, campaignId, editorSessionId) };
  } catch (error) {
    if (error instanceof DraftStoreUnavailableError) throw error;
    throw new DraftStoreUnavailableError(error);
  }
};

export const rebaseSessionDraft = async (
  userId: string,
  campaignId: string,
  editorSessionId: string,
  draftRevision: number,
  basePcrRevision: number,
): Promise<boolean> => {
  try {
    const result = await connection.eval(
      SESSION_DRAFT_REBASE_SCRIPT,
      1,
      sessionDraftKey(userId, campaignId, editorSessionId),
      userId,
      String(draftRevision),
      String(basePcrRevision),
      String(DRAFT_TTL_SECONDS),
    );

    return Number(result) === 1;
  } catch (error) {
    throw new DraftStoreUnavailableError(error);
  }
};
