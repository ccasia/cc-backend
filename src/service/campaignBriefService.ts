import { CampaignDraftStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma/prisma';
import { generateRandomString } from '@utils/randomString';
import { classifyBriefRole } from '@utils/briefRoles';

const MAGIC_TOKEN_TTL_DAYS = 14;
const MAGIC_TOKEN_LENGTH = 32;

const CLIENT_EDITABLE_FIELDS = new Set<string>([
  'brandName',
  'industry',
  'dateFrom',
  'dateTo',
  'secondaryObjectives',
  'kpis',
  'kpiNotes',
  'extraNotes',
  'audienceGender',
  'audienceAge',
  'country',
  'audienceLanguage',
  'audienceCreatorPersona',
  'audienceUserPersona',
  'geographicFocus',
  'geographicFocusOthers',
]);

type BriefUpdateInput = Record<string, unknown>;

const generateUniqueMagicToken = async (): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateRandomString(MAGIC_TOKEN_LENGTH);
    const clash = await prisma.campaign.findUnique({ where: { clientMagicToken: token } });
    if (!clash) return token;
  }
  throw new Error('Could not generate a unique magic token after 5 attempts');
};

const expiryFromNow = (): Date => {
  const d = new Date();
  d.setDate(d.getDate() + MAGIC_TOKEN_TTL_DAYS);
  return d;
};

const allowedTransitions: Record<CampaignDraftStatus, CampaignDraftStatus[]> = {
  DRAFTED: ['SENT_TO_CLIENT', 'LOST'],
  SENT_TO_CLIENT: ['SENT_TO_CLIENT', 'APPROVED', 'PENDING_REVIEW', 'LOST'],
  PENDING_REVIEW: ['SENT_TO_CLIENT', 'APPROVED', 'HANDED_OVER', 'LOST'],
  APPROVED: ['HANDED_OVER', 'LOST'],
  HANDED_OVER: [],
  LOST: [],
};

const assertTransition = (from: CampaignDraftStatus, to: CampaignDraftStatus) => {
  if (from === to) return;
  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
};

export const createDraftBrief = async (
  bdUserId: string,
  origin: 'BD_CREATED' | 'CSL_CREATED' | 'CSM_CREATED' = 'BD_CREATED',
) => {
  return prisma.campaign.create({
    data: {
      name: '',
      description: '',
      status: 'DRAFT',
      origin: 'ADMIN',
      draftStatus: 'DRAFTED',
      draftOrigin: origin,
      submissionVersion: 'v4',
      isCreditTier: true,
      // Start at 0, NOT 1. campaignCredits must mirror what has actually been
      // charged to the company's subscription pool. A phantom credit here makes
      // updateAllCampaignCredits charge only (requested - 1) at activation
      // (delta-based FIFO), leaving the pool off by one. The CSM sets the real
      // amount during activation, which then charges the full delta from 0.
      campaignCredits: 0,
      briefOwnerId: bdUserId,
      campaignAdmin: {
        create: { adminId: bdUserId, role: 'owner' },
      },
    },
  });
};

export const updateDraftBrief = async (briefId: string, patch: BriefUpdateInput, actor: 'bd' | 'client') => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      name: true,
      draftStatus: true,
      editedByClientFields: true,
      clientBriefSnapshot: true,
      campaignBrief: { select: { id: true } },
      campaignRequirement: { select: { id: true } },
      campaignAdditionalDetails: { select: { id: true, specialNotesInstructions: true } },
    },
  });
  if (!current || !current.draftStatus) {
    throw new Error('Brief not found');
  }

  if (actor === 'client') {
    const disallowed = Object.keys(patch).filter((k) => !CLIENT_EDITABLE_FIELDS.has(k));
    if (disallowed.length > 0) {
      throw new Error(`Client may not edit fields: ${disallowed.join(', ')}`);
    }
  }

  const dataPatch: Prisma.CampaignUpdateInput = mapBriefPatch(patch, current);

  if (actor === 'client') {
    // Recompute the edited-field list against the BD-sent snapshot: a field is
    // "edited" only while it differs from what was sent. Comparing (rather than
    // appending) means reverting a field to its sent value clears the flag, and
    // the result is stable across refreshes since the snapshot is the baseline.
    const snapshot = (current.clientBriefSnapshot || {}) as BriefSnapshot;
    const edited = new Set(current.editedByClientFields || []);
    for (const field of Object.keys(patch)) {
      if (valuesEqual(patch[field], snapshot[field], field)) {
        edited.delete(field);
      } else {
        edited.add(field);
      }
    }
    dataPatch.editedByClientFields = { set: Array.from(edited) };
  }

  return prisma.campaign.update({
    where: { id: briefId },
    data: dataPatch,
  });
};

// Translates the bd-brief-form payload (what the frontend brief form sends)
// into nested writes across Campaign / CampaignBrief / CampaignRequirement /
// CampaignAdditionalDetails. Field names mirror
// cc-frontend/src/sections/public-access/bd-brief-form.jsx.
type CurrentBriefRecord = {
  name?: string | null;
  campaignBrief?: { id: string } | null;
  campaignRequirement?: { id: string } | null;
  campaignAdditionalDetails?: { specialNotesInstructions?: string | null } | null;
};

const mapBriefPatch = (patch: BriefUpdateInput, current?: CurrentBriefRecord): Prisma.CampaignUpdateInput => {
  const out: Prisma.CampaignUpdateInput = {};
  const briefData: Prisma.CampaignBriefUpdateWithoutCampaignInput = {};
  const requirementData: Prisma.CampaignRequirementUpdateWithoutCampaignInput = {};
  const additionalDetailsData: Prisma.CampaignAdditionalDetailsUpdateWithoutCampaignInput = {};

  // ── Campaign-level fields ──────────────────────────────────────────────
  if (typeof patch.brandName === 'string') out.name = patch.brandName;
  if (typeof patch.extraNotes === 'string') out.description = patch.extraNotes;

  // ── CampaignBrief fields ───────────────────────────────────────────────
  if (typeof patch.brandName === 'string') briefData.title = patch.brandName;
  if (typeof patch.industry === 'string') briefData.industries = patch.industry;
  if (patch.dateFrom !== undefined) {
    briefData.postingStartDate = patch.dateFrom ? new Date(patch.dateFrom as string) : null;
    if (briefData.postingStartDate) briefData.startDate = briefData.postingStartDate;
  }
  if (patch.dateTo !== undefined) {
    briefData.postingEndDate = patch.dateTo ? new Date(patch.dateTo as string) : null;
    if (briefData.postingEndDate) briefData.endDate = briefData.postingEndDate;
  }
  // bd-brief-form sends the selected objectives in `secondaryObjectives`. We
  // default the primary `objectives` column to 'Awareness' and persist the full
  // selected array in `secondaryObjectives`, matching the bdSubmitDraft layout
  // (which always sends primaryGoal='Awareness' alongside).
  if (Array.isArray(patch.secondaryObjectives)) {
    const cleaned = patch.secondaryObjectives.filter((v): v is string => typeof v === 'string');
    briefData.objectives = 'Awareness';
    briefData.secondaryObjectives = cleaned;
  }

  // ── CampaignAdditionalDetails: KPIs + KPI notes flow into the
  //    specialNotesInstructions field for parity with bdSubmitDraft. We
  //    rebuild the combined string on each patch that touches either.
  if (patch.kpis !== undefined || patch.kpiNotes !== undefined) {
    const existing = current?.campaignAdditionalDetails?.specialNotesInstructions || '';
    const prevKpisMatch = /KPIs:\s*(.+)/.exec(existing);
    const prevNotesMatch = /KPI notes:\s*([\s\S]+)/.exec(existing);

    const kpis = Array.isArray(patch.kpis)
      ? patch.kpis.filter((v): v is string => typeof v === 'string')
      : prevKpisMatch
        ? prevKpisMatch[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const kpiNotes =
      typeof patch.kpiNotes === 'string' ? patch.kpiNotes.trim() : prevNotesMatch ? prevNotesMatch[1].trim() : '';

    const parts: string[] = [];
    if (kpis.length) parts.push(`KPIs: ${kpis.join(', ')}`);
    if (kpiNotes) parts.push(`KPI notes: ${kpiNotes}`);
    additionalDetailsData.specialNotesInstructions = parts.length ? parts.join('\n\n') : null;
  }

  // ── CampaignRequirement fields ─────────────────────────────────────────
  if (Array.isArray(patch.audienceGender))
    requirementData.gender = patch.audienceGender.filter((v): v is string => typeof v === 'string');
  if (Array.isArray(patch.audienceAge))
    requirementData.age = patch.audienceAge.filter((v): v is string => typeof v === 'string');
  if (typeof patch.country === 'string') requirementData.country = patch.country;
  if (Array.isArray(patch.audienceLanguage)) {
    requirementData.language = patch.audienceLanguage.filter((v): v is string => typeof v === 'string');
  }
  if (Array.isArray(patch.audienceCreatorPersona)) {
    requirementData.creator_persona = patch.audienceCreatorPersona.filter((v): v is string => typeof v === 'string');
  }
  if (typeof patch.audienceUserPersona === 'string') requirementData.user_persona = patch.audienceUserPersona;
  if (typeof patch.geographicFocus === 'string') {
    requirementData.geographic_focus = patch.geographicFocus || null;
  }
  if (typeof patch.geographicFocusOthers === 'string') {
    requirementData.geographicFocusOthers = patch.geographicFocusOthers || null;
  }

  // Build a self-sufficient `create` payload for each upsert branch so the
  // first patch that touches a nested table (when the row doesn't exist yet)
  // satisfies all required columns. Required-on-create fields for CampaignBrief:
  // title, startDate, endDate. Fall back to current Campaign name / a stub date
  // when the patch doesn't supply them itself.
  if (Object.keys(briefData).length > 0) {
    if (current?.campaignBrief) {
      out.campaignBrief = { update: briefData };
    } else {
      const now = new Date();
      const briefCreate: Prisma.CampaignBriefCreateWithoutCampaignInput = {
        title: typeof briefData.title === 'string' ? briefData.title : current?.name || 'Untitled Brief',
        startDate: (briefData.startDate as Date) || now,
        endDate: (briefData.endDate as Date) || now,
        images: [],
        ...briefData,
      } as Prisma.CampaignBriefCreateWithoutCampaignInput;
      out.campaignBrief = { upsert: { create: briefCreate, update: briefData } };
    }
  }
  if (Object.keys(requirementData).length > 0) {
    if (current?.campaignRequirement) {
      out.campaignRequirement = { update: requirementData };
    } else {
      // CampaignRequirement.user_persona is required; default to empty string.
      const reqCreate: Prisma.CampaignRequirementCreateWithoutCampaignInput = {
        user_persona: typeof requirementData.user_persona === 'string' ? requirementData.user_persona : '',
        ...(requirementData as any),
      };
      out.campaignRequirement = { upsert: { create: reqCreate, update: requirementData } };
    }
  }
  if (Object.keys(additionalDetailsData).length > 0) {
    if (current?.campaignAdditionalDetails) {
      out.campaignAdditionalDetails = { update: additionalDetailsData };
    } else {
      out.campaignAdditionalDetails = {
        upsert: { create: additionalDetailsData as any, update: additionalDetailsData },
      };
    }
  }

  return out;
};

// ── Client "edited" detection ────────────────────────────────────────────────
// The brief is snapshotted (in the same field shape the patch accepts) when sent
// to the client. A field counts as "edited by client" only when its current
// value differs from that snapshot, so a revert to the sent value clears it.

type BriefSnapshot = Record<string, unknown>;

// Build the comparable field map from a brief's persisted nested records. Mirrors
// the bd-brief-form payload shape (and the frontend brief-form defaultValues), so
// snapshot values are directly comparable to incoming patch values.
const buildBriefSnapshot = (brief: {
  name?: string | null;
  description?: string | null;
  campaignBrief?: {
    industries?: string | null;
    postingStartDate?: Date | null;
    postingEndDate?: Date | null;
    objectives?: string | null;
    secondaryObjectives?: string[] | null;
  } | null;
  campaignRequirement?: {
    gender?: string[] | null;
    age?: string[] | null;
    country?: string | null;
    language?: string[] | null;
    creator_persona?: string[] | null;
    user_persona?: string | null;
    geographic_focus?: string | null;
    geographicFocusOthers?: string | null;
  } | null;
  campaignAdditionalDetails?: { specialNotesInstructions?: string | null } | null;
}): BriefSnapshot => {
  const specialNotes = brief.campaignAdditionalDetails?.specialNotesInstructions || '';
  const kpiLine = /KPIs:\s*(.+)/.exec(specialNotes);
  const kpiNotesLine = /KPI notes:\s*([\s\S]+)/.exec(specialNotes);
  const kpis = kpiLine
    ? kpiLine[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Mirror the form: the objectives grid uses only `secondaryObjectives` (the
  // selectable card values). The fixed `objectives='Awareness'` primary is not a
  // grid card, so it must not be folded into this array.
  const combinedObjectives = brief.campaignBrief?.secondaryObjectives || [];

  return {
    brandName: brief.name || '',
    industry: brief.campaignBrief?.industries || '',
    dateFrom: brief.campaignBrief?.postingStartDate
      ? new Date(brief.campaignBrief.postingStartDate).toISOString()
      : null,
    dateTo: brief.campaignBrief?.postingEndDate ? new Date(brief.campaignBrief.postingEndDate).toISOString() : null,
    secondaryObjectives: combinedObjectives,
    kpis,
    kpiNotes: kpiNotesLine ? kpiNotesLine[1].trim() : '',
    extraNotes: brief.description || '',
    audienceGender: brief.campaignRequirement?.gender || [],
    audienceAge: brief.campaignRequirement?.age || [],
    country: brief.campaignRequirement?.country || '',
    audienceLanguage: brief.campaignRequirement?.language || [],
    audienceCreatorPersona: brief.campaignRequirement?.creator_persona || [],
    audienceUserPersona: brief.campaignRequirement?.user_persona || '',
    geographicFocus: brief.campaignRequirement?.geographic_focus || '',
    geographicFocusOthers: brief.campaignRequirement?.geographicFocusOthers || '',
  };
};

// The snapshot's date fields are stored as ISO strings, but the client may send
// dates in a looser form (e.g. 'YYYY-MM-DD'). Normalize both ends so equal dates
// compare equal regardless of representation.
const DATE_FIELDS = new Set(['dateFrom', 'dateTo']);

const normalizeDate = (v: unknown): string => {
  if (v == null || v === '') return '';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

// Normalize a field value to a comparable primitive. Handles the snapshot/patch
// value shapes: strings, null/undefined, ISO-or-Date dates, and arrays.
const normalizeForCompare = (v: unknown, field?: string): string => {
  if (field && DATE_FIELDS.has(field)) return normalizeDate(v);
  if (v == null) return '';
  if (Array.isArray(v)) {
    return JSON.stringify([...v].map((x) => String(x)).sort());
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

const valuesEqual = (a: unknown, b: unknown, field?: string): boolean =>
  normalizeForCompare(a, field) === normalizeForCompare(b, field);

export const sendBriefToClient = async (briefId: string, clientName: string, clientEmail: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      draftStatus: true,
      name: true,
      description: true,
      campaignBrief: {
        select: {
          industries: true,
          postingStartDate: true,
          postingEndDate: true,
          objectives: true,
          secondaryObjectives: true,
        },
      },
      campaignRequirement: {
        select: {
          gender: true,
          age: true,
          country: true,
          language: true,
          creator_persona: true,
          user_persona: true,
          geographic_focus: true,
          geographicFocusOthers: true,
        },
      },
      campaignAdditionalDetails: { select: { specialNotesInstructions: true } },
    },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');
  assertTransition(current.draftStatus, 'SENT_TO_CLIENT');

  const magicToken = await generateUniqueMagicToken();
  const snapshot = buildBriefSnapshot(current);

  return prisma.campaign.update({
    where: { id: briefId },
    data: {
      draftStatus: 'SENT_TO_CLIENT',
      clientName,
      clientEmail,
      clientMagicToken: magicToken,
      clientTokenExpiresAt: expiryFromNow(),
      sentToClientAt: new Date(),
      // (Re)snapshot the sent baseline. Reset the edited-field list so a resend
      // starts the client's review fresh against the current brief.
      clientBriefSnapshot: snapshot as Prisma.InputJsonValue,
      editedByClientFields: { set: [] },
    },
  });
};

// BD/admin approves an incoming brief (e.g. a PENDING_REVIEW prospect
// submission). Advances to APPROVED, after which handover becomes available.
export const approveBriefByBd = async (briefId: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: { id: true, draftStatus: true },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');
  assertTransition(current.draftStatus, 'APPROVED');

  return prisma.campaign.update({
    where: { id: current.id },
    data: {
      draftStatus: 'APPROVED',
      approvedAt: new Date(),
    },
  });
};

// Captures the as-submitted public-form values as the reset baseline. Called
// right after a CLIENT_INVITED brief is created so the BD's RESET FORM can later
// revert their edits back to what the prospect originally submitted. Reuses the
// clientBriefSnapshot column (the brief is still in BD review; send-to-client
// re-snapshots it afterward, by which point this baseline is no longer needed).
export const snapshotPublicSubmission = async (briefId: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      name: true,
      description: true,
      campaignBrief: {
        select: {
          industries: true,
          postingStartDate: true,
          postingEndDate: true,
          objectives: true,
          secondaryObjectives: true,
        },
      },
      campaignRequirement: {
        select: {
          gender: true,
          age: true,
          country: true,
          language: true,
          creator_persona: true,
          user_persona: true,
          geographic_focus: true,
          geographicFocusOthers: true,
        },
      },
      campaignAdditionalDetails: { select: { specialNotesInstructions: true } },
    },
  });
  if (!current) throw new Error('Brief not found');

  const snapshot = buildBriefSnapshot(current);
  return prisma.campaign.update({
    where: { id: current.id },
    data: { clientBriefSnapshot: snapshot as Prisma.InputJsonValue },
  });
};

// Reverts a brief's editable fields back to the stored clientBriefSnapshot. For a
// PENDING_REVIEW (CLIENT_INVITED) brief this is the original prospect submission;
// it mirrors the client-side "reset to BD-sent snapshot" behavior. Returns the
// updated brief so the caller can reseed the form.
export const resetBriefToSnapshot = async (briefId: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: { id: true, draftStatus: true, clientBriefSnapshot: true },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');
  const snapshot = (current.clientBriefSnapshot || null) as BriefSnapshot | null;
  if (!snapshot) throw new Error('No snapshot to reset to');

  // Reuse the standard BD update path so child records (brief/requirement/
  // additionalDetails) are written consistently with normal autosave.
  return updateDraftBrief(briefId, snapshot as BriefUpdateInput, 'bd');
};

export const approveBriefByClient = async (magicToken: string) => {
  const current = await prisma.campaign.findUnique({
    where: { clientMagicToken: magicToken },
    select: { id: true, draftStatus: true, clientTokenExpiresAt: true },
  });
  if (!current || !current.draftStatus) throw new Error('Not found');
  if (current.clientTokenExpiresAt && current.clientTokenExpiresAt < new Date()) {
    throw new Error('Not found');
  }
  assertTransition(current.draftStatus, 'APPROVED');

  return prisma.campaign.update({
    where: { id: current.id },
    data: {
      draftStatus: 'APPROVED',
      approvedAt: new Date(),
      // Token stays valid so BD can still view what the client saw, but the
      // approve action is single-shot via the state machine.
    },
  });
};

type ExtendedTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const nextCampaignCode = async (tx: ExtendedTxClient): Promise<string> => {
  const existing = await tx.campaign.findMany({
    where: { campaignId: { startsWith: 'C' } },
    select: { campaignId: true },
  });

  const maxNum = existing.reduce((max, row) => {
    const m = /^C(\d+)$/.exec(row.campaignId ?? '');
    const n = m ? parseInt(m[1], 10) : 0;
    return n > max ? n : max;
  }, 0);
  const next = maxNum + 1;
  return `C${next < 10 ? `0${next}` : next}`;
};

export const handoverBrief = async (
  briefId: string,
  clientPackage: string | null,
  internalComments: string | null,
  won?: { amount: number | null; currency: string | null },
) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: { id: true, draftStatus: true, briefOwnerId: true, campaignId: true },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');
  assertTransition(current.draftStatus, 'HANDED_OVER');

  return prisma.$transaction(async (tx) => {
    const campaignCode = current.campaignId || (await nextCampaignCode(tx));

    const updated = await tx.campaign.update({
      where: { id: briefId },
      data: {
        campaignId: campaignCode,
        draftStatus: 'HANDED_OVER',
        status: 'PENDING_ADMIN_ACTIVATION',
        clientPackage,
        internalComments: internalComments ?? null,
        handedOverAt: new Date(),
        wonAmount: won?.amount ?? null,
        wonCurrency: won?.currency ?? null,
        clientMagicToken: null,
        clientTokenExpiresAt: null,
      },
    });

    if (current.briefOwnerId) {
      await tx.campaignAdmin.deleteMany({
        where: { campaignId: briefId, adminId: current.briefOwnerId },
      });
    }

    return updated;
  });
};

// CSL assigns one or more CSMs to a handed-over campaign. This is assignment
// ONLY — the campaign stays PENDING_ADMIN_ACTIVATION; the assigned CSM completes
// activation later (agreement, deliverables, etc.). CSMs are added to
// campaignAdmin with role 'manager', which is also how listBriefs scopes a CSM's
// visibility to the briefs they've been assigned.
export const assignCsmToBrief = async (briefId: string, csmUserIds: string[], internalComments?: string | null) => {
  const ids = Array.from(new Set(csmUserIds.filter((id) => typeof id === 'string' && id)));
  if (ids.length === 0) throw new Error('Select at least one CSM to assign.');

  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      draftStatus: true,
      draftOrigin: true,
      campaignId: true,
      briefOwnerId: true,
      companyId: true,
      brandId: true,
      company: {
        select: { name: true, subscriptions: { where: { status: 'ACTIVE' }, select: { id: true } } },
      },
      brand: {
        select: {
          name: true,
          company: { select: { subscriptions: { where: { status: 'ACTIVE' }, select: { id: true } } } },
        },
      },
    },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');

  const isAlreadyHandedOver = current.draftStatus === 'HANDED_OVER';
  const needsSelfHandover = current.draftStatus === 'APPROVED' && current.draftOrigin === 'CSL_CREATED';
  if (!isAlreadyHandedOver && !needsSelfHandover) {
    throw new Error('CSMs can only be assigned to handed-over campaigns.');
  }

  if (needsSelfHandover) {
    if (!current.companyId && !current.brandId) {
      throw new Error('Link a company before assigning a CSM.');
    }
    const activeSubs = current.company?.subscriptions?.length || current.brand?.company?.subscriptions?.length || 0;
    if (activeSubs === 0) {
      throw new Error('Attach an active package to the company before assigning a CSM.');
    }
  }

  // Verify every id is actually a CSM admin before assigning.
  const csmAdmins = await prisma.admin.findMany({
    where: {
      userId: { in: ids },
      role: { name: { in: ['CSM', 'Customer Success Manager'] } },
    },
    select: { userId: true },
  });
  const validIds = new Set(csmAdmins.map((a) => a.userId));
  const invalid = ids.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new Error('One or more selected users are not CSM admins.');
  }

  return prisma.$transaction(async (tx) => {
    if (needsSelfHandover) {
      const campaignCode = current.campaignId || (await nextCampaignCode(tx));
      await tx.campaign.update({
        where: { id: briefId },
        data: {
          campaignId: campaignCode,
          draftStatus: 'HANDED_OVER',
          status: 'PENDING_ADMIN_ACTIVATION',
          clientPackage: current.company?.name || current.brand?.name || null,
          internalComments: internalComments ?? null,
          handedOverAt: new Date(),
          clientMagicToken: null,
          clientTokenExpiresAt: null,
        },
      });
      if (current.briefOwnerId) {
        await tx.campaignAdmin.deleteMany({
          where: { campaignId: briefId, adminId: current.briefOwnerId },
        });
      }
    } else if (internalComments != null) {
      await tx.campaign.update({
        where: { id: briefId },
        data: { internalComments },
      });
    }

    for (const adminId of ids) {
      await tx.campaignAdmin.upsert({
        where: { adminId_campaignId: { adminId, campaignId: briefId } },
        create: { adminId, campaignId: briefId, role: 'manager' },
        update: { role: 'manager' },
      });
    }
    return tx.campaign.findUnique({
      where: { id: briefId },
      select: { id: true, draftStatus: true, status: true },
    });
  });
};

// A CSM who authored the brief (CSM_CREATED) finalizes it into their own
// campaign at APPROVED — there is no handover to CSL and no CSM selection. The
// brief owner stays on the campaign as 'manager' (mirroring how assigned CSMs
// appear elsewhere). Requires a linked company with an active package, same as
// the CSL self-handover precondition.
export const finalizeOwnBrief = async (
  briefId: string,
  ownerUserId: string,
  internalComments?: string | null,
  won?: { amount: number | null; currency: string | null },
) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      draftStatus: true,
      draftOrigin: true,
      campaignId: true,
      briefOwnerId: true,
      companyId: true,
      brandId: true,
      company: {
        select: { name: true, subscriptions: { where: { status: 'ACTIVE' }, select: { id: true } } },
      },
      brand: {
        select: {
          name: true,
          company: { select: { subscriptions: { where: { status: 'ACTIVE' }, select: { id: true } } } },
        },
      },
    },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');

  if (current.draftOrigin !== 'CSM_CREATED') {
    throw new Error('Only CSM-authored briefs can be finalized this way.');
  }
  if (current.briefOwnerId !== ownerUserId) {
    throw new Error('Only the brief owner can finalize this campaign.');
  }
  if (current.draftStatus !== 'APPROVED') {
    throw new Error('The client must approve the brief before it can be finalized.');
  }
  if (!current.companyId && !current.brandId) {
    throw new Error('Link a company before finalizing.');
  }
  const activeSubs = current.company?.subscriptions?.length || current.brand?.company?.subscriptions?.length || 0;
  if (activeSubs === 0) {
    throw new Error('Attach an active package to the company before finalizing.');
  }

  return prisma.$transaction(async (tx) => {
    const campaignCode = current.campaignId || (await nextCampaignCode(tx));
    await tx.campaign.update({
      where: { id: briefId },
      data: {
        campaignId: campaignCode,
        draftStatus: 'HANDED_OVER',
        status: 'PENDING_ADMIN_ACTIVATION',
        clientPackage: current.company?.name || current.brand?.name || null,
        internalComments: internalComments ?? null,
        handedOverAt: new Date(),
        wonAmount: won?.amount ?? null,
        wonCurrency: won?.currency ?? null,
        clientMagicToken: null,
        clientTokenExpiresAt: null,
      },
    });

    // Keep the CSM on the campaign, but as 'manager' so they surface in the same
    // manager-based views/queries as assigned CSMs.
    await tx.campaignAdmin.upsert({
      where: { adminId_campaignId: { adminId: ownerUserId, campaignId: briefId } },
      create: { adminId: ownerUserId, campaignId: briefId, role: 'manager' },
      update: { role: 'manager' },
    });

    return tx.campaign.findUnique({
      where: { id: briefId },
      select: { id: true, draftStatus: true, status: true },
    });
  });
};

export const deleteBrief = async (briefId: string) => {
  // CampaignBrief / CampaignRequirement / CampaignAdditionalDetails relations
  // don't cascade on delete, so a campaign with those rows (e.g. a publicly
  // submitted brief) can't be removed directly — clear the children first, then
  // the campaign. campaignAdmin cascades on its own.
  return prisma.$transaction(async (tx) => {
    await tx.campaignBrief.deleteMany({ where: { campaignId: briefId } });
    await tx.campaignRequirement.deleteMany({ where: { campaignId: briefId } });
    await tx.campaignAdditionalDetails.deleteMany({ where: { campaignId: briefId } });
    return tx.campaign.delete({ where: { id: briefId } });
  });
};

// Max number of attachments a brief may carry.
export const BRIEF_ATTACHMENT_MAX = 3;

// Append an attachment URL to the brief's attachment list (campaignBrief.
// otherAttachments). Caller uploads the file to GCS and provides the URL.
// Enforces the BRIEF_ATTACHMENT_MAX cap and throws if it's already full.
export const addBriefAttachmentUrl = async (briefId: string, url: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      draftStatus: true,
      campaignBrief: { select: { id: true, otherAttachments: true } },
    },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');

  const existing = current.campaignBrief?.otherAttachments || [];
  if (existing.length >= BRIEF_ATTACHMENT_MAX) {
    const err: any = new Error(`A brief can have at most ${BRIEF_ATTACHMENT_MAX} attachments`);
    err.code = 'ATTACHMENT_LIMIT';
    throw err;
  }

  const next = [...existing, url];
  await prisma.campaign.update({
    where: { id: briefId },
    data: {
      campaignBrief: {
        update: { otherAttachments: next },
      },
    },
  });
  return next;
};

// Remove a single attachment from the brief by URL, or clear all when no URL is
// given. The GCS object itself is left in place — acceptable for this
// lead-capture flow, mirroring how orphaned uploads are tolerated elsewhere.
export const removeBriefAttachmentUrl = async (briefId: string, url?: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      draftStatus: true,
      campaignBrief: { select: { id: true, otherAttachments: true } },
    },
  });
  if (!current || !current.draftStatus) throw new Error('Brief not found');
  if (!current.campaignBrief) return [];

  const existing = current.campaignBrief.otherAttachments || [];
  const next = url ? existing.filter((u) => u !== url) : [];

  await prisma.campaign.update({
    where: { id: briefId },
    data: {
      campaignBrief: {
        update: { otherAttachments: next },
      },
    },
  });
  return next;
};

// Listing visibility:
//   Superadmin → all briefs with a non-null draftStatus.
//   BD         → only briefs they own (briefOwnerId) — survives handover, which
//                removes them from campaignAdmin.
//   CSL        → all HANDED_OVER briefs, by role (NOT membership), PLUS their own
//                in-progress briefs they authored (CSL_CREATED, pre-handover) so
//                they can drive them through send → approve → assign.
//   CS (CSM)   → the HANDED_OVER briefs they've been assigned to (campaignAdmin
//                membership), PLUS any brief they authored themselves.
export const listBriefs = async (user: Parameters<typeof classifyBriefRole>[0], userId: string) => {
  const role = classifyBriefRole(user);

  let where: Prisma.CampaignWhereInput;
  if (role === 'superadmin') {
    where = { draftStatus: { not: null } };
  } else if (role === 'BD') {
    where = {
      draftStatus: { not: null },
      briefOwnerId: userId,
    };
  } else if (role === 'CSL') {
    where = {
      OR: [{ draftStatus: 'HANDED_OVER' }, { briefOwnerId: userId, draftStatus: { not: null } }],
    };
  } else if (role === 'CS') {
    where = {
      draftStatus: { not: null },
      OR: [{ draftStatus: 'HANDED_OVER', campaignAdmin: { some: { adminId: userId } } }, { briefOwnerId: userId }],
    };
  } else {
    return [];
  }

  const briefs = await prisma.campaign.findMany({
    where,
    select: {
      id: true,
      name: true,
      clientName: true,
      clientEmail: true,
      draftStatus: true,
      // Campaign lifecycle status — lets the list surface post-handover state
      // (e.g. ACTIVE once a CSM/CSL activates the campaign) instead of staying
      // stuck on the draft's HANDED_OVER badge.
      status: true,
      draftOrigin: true,
      briefOwnerId: true,
      createdAt: true,
      sentToClientAt: true,
      approvedAt: true,
      handedOverAt: true,
      clientMagicToken: true,
      clientTokenExpiresAt: true,
      lostAmount: true,
      lostCurrency: true,
      lostReason: true,
      campaignAdmin: {
        where: { role: 'owner' },
        select: { admin: { select: { user: { select: { id: true, name: true } } } } },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // briefOwnerId is a bare scalar (no relation), and the BD is removed from
  // campaignAdmin on handover — so resolve owner names in one extra lookup and
  // attach a `briefOwner` { id, name } to each brief for the BD-owner filter.
  const ownerIds = [...new Set(briefs.map((b) => b.briefOwnerId).filter((v): v is string => !!v))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  return briefs.map((b) => ({
    ...b,
    briefOwner: b.briefOwnerId ? ownerById.get(b.briefOwnerId) || null : null,
  }));
};

export const getBriefById = async (briefId: string) => {
  return prisma.campaign.findFirst({
    where: { id: briefId, draftStatus: { not: null } },
    include: {
      campaignBrief: true,
      campaignRequirement: true,
      campaignAdditionalDetails: true,
      campaignAdmin: {
        select: {
          role: true,
          admin: { select: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
      company: {
        include: {
          subscriptions: { include: { package: true, customPackage: true } },
        },
      },
      brand: {
        include: {
          company: {
            include: {
              subscriptions: { include: { package: true, customPackage: true } },
            },
          },
        },
      },
    },
  });
};

export const getBriefByMagicToken = async (magicToken: string) => {
  const brief = await prisma.campaign.findUnique({
    where: { clientMagicToken: magicToken },
    include: {
      campaignBrief: true,
      campaignRequirement: true,
      campaignAdditionalDetails: true,
    },
  });
  if (!brief) return null;
  if (brief.clientTokenExpiresAt && brief.clientTokenExpiresAt < new Date()) return null;
  return brief;
};

// CSL (CS Lead) users — recipients of the handover.
export const listCslUsers = async () => {
  return prisma.admin.findMany({
    where: {
      role: {
        name: { in: ['CSL', 'CS Lead'] },
      },
    },
    select: {
      userId: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
};

// ---------------------------------------------------------------------------
// BD dashboard aggregate
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCY = 'MYR';

// Role-name test mirroring isBDUser in @utils/briefRoles (and the isBdOrSuperadmin
// middleware). Kept local as a plain string test so it can filter a fetched list.
const isBdRoleName = (roleName?: string | null): boolean => {
  const name = (roleName || '').toLowerCase();
  return (
    name === 'bd' ||
    name.includes('business development') ||
    name === 'sales and marketing' ||
    name.includes('sales and marketing')
  );
};

type MonthRange = { start: Date; end: Date; label: string };

// Resolve a YYYY-MM (or current month) to a [start, end) range. Uses the server's
// local time — deployments run Asia/Kuala_Lumpur, matching the cron timezone.
export const resolveMonthRange = (month?: string): MonthRange => {
  const now = new Date();
  let year = now.getFullYear();
  let monthIndex = now.getMonth();
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    year = y;
    monthIndex = m - 1;
  }
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
  const label = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return { start, end, label };
};

const emptyBucket = () => ({ wonCount: 0, wonAmount: 0, lostCount: 0, lostAmount: 0 });

export const getBdDashboard = async (currentUserId: string, month?: string) => {
  const { start, end, label } = resolveMonthRange(month);

  // Team = admins whose role name classifies as BD. Fetch admins with a role
  // and filter by the shared name test (Prisma can't do case-insensitive
  // multi-pattern matching cleanly in one where).
  const admins = await prisma.admin.findMany({
    where: { role: { isNot: null } },
    select: {
      userId: true,
      role: { select: { name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  const bdMembers = admins.filter((a) => isBdRoleName(a.role?.name));
  const bdUserIds = bdMembers.map((a) => a.userId);
  // Ensure the current user is represented even if their role naming is atypical.
  const memberIds = Array.from(new Set([currentUserId, ...bdUserIds]));

  // Won = handed over this month, grouped by owner + currency.
  const wonRows = await prisma.campaign.findMany({
    where: {
      draftStatus: 'HANDED_OVER',
      handedOverAt: { gte: start, lt: end },
      briefOwnerId: { in: memberIds },
    },
    select: { briefOwnerId: true, wonAmount: true, wonCurrency: true },
  });

  // Lost = lost this month (fall back to updatedAt for pre-migration rows),
  // grouped by owner + currency.
  const lostRows = await prisma.campaign.findMany({
    where: {
      draftStatus: 'LOST',
      briefOwnerId: { in: memberIds },
      OR: [{ lostAt: { gte: start, lt: end } }, { AND: [{ lostAt: null }, { updatedAt: { gte: start, lt: end } }] }],
    },
    select: { briefOwnerId: true, lostAmount: true, lostCurrency: true },
  });

  // Per-user, per-currency accumulator. null currency → default bucket.
  const byUser = new Map<string, Record<string, ReturnType<typeof emptyBucket>>>();
  const bucketFor = (userId: string | null, currency: string | null) => {
    const uid = userId || 'unknown';
    const cur = currency || DEFAULT_CURRENCY;
    if (!byUser.has(uid)) byUser.set(uid, {});
    const perCur = byUser.get(uid)!;
    if (!perCur[cur]) perCur[cur] = emptyBucket();
    return perCur[cur];
  };

  wonRows.forEach((r) => {
    const b = bucketFor(r.briefOwnerId, r.wonCurrency);
    b.wonCount += 1;
    b.wonAmount += r.wonAmount || 0;
  });
  lostRows.forEach((r) => {
    const b = bucketFor(r.briefOwnerId, r.lostCurrency);
    b.lostCount += 1;
    b.lostAmount += r.lostAmount || 0;
  });

  const currencies = new Set<string>([DEFAULT_CURRENCY, 'SGD']);
  byUser.forEach((perCur) => Object.keys(perCur).forEach((c) => currencies.add(c)));

  const withWinRate = (bucket: ReturnType<typeof emptyBucket>) => {
    const decided = bucket.wonCount + bucket.lostCount;
    return { ...bucket, winRate: decided > 0 ? bucket.wonCount / decided : null };
  };

  const bucketsForUser = (userId: string) => {
    const perCur = byUser.get(userId) || {};
    const out: Record<string, ReturnType<typeof withWinRate>> = {};
    currencies.forEach((c) => {
      out[c] = withWinRate(perCur[c] || emptyBucket());
    });
    return out;
  };

  const me = bucketsForUser(currentUserId);

  const nameById = new Map(bdMembers.map((a) => [a.userId, a.user?.name || 'Unknown']));
  const members = bdUserIds.map((uid) => ({
    userId: uid,
    name: nameById.get(uid) || 'Unknown',
    ...bucketsForUser(uid),
  }));

  const totals: Record<string, { wonCount: number; wonAmount: number }> = {};
  currencies.forEach((c) => {
    totals[c] = { wonCount: 0, wonAmount: 0 };
  });
  members.forEach((m) => {
    currencies.forEach((c) => {
      totals[c].wonCount += (m as any)[c].wonCount;
      totals[c].wonAmount += (m as any)[c].wonAmount;
    });
  });

  return {
    month: label,
    currencies: Array.from(currencies),
    me,
    team: { members, totals },
  };
};

export const lostBrief = async (briefId: string, lostAmount: number, lostCurrency: string, lostReason: string) => {
  const current = await prisma.campaign.findUnique({
    where: { id: briefId },
    select: { id: true, draftStatus: true },
  });

  if (!current || !current.draftStatus) {
    throw new Error('Brief not found');
  }

  assertTransition(current.draftStatus, 'LOST');

  return prisma.campaign.update({
    where: { id: briefId },
    data: {
      draftStatus: 'LOST',
      lostAmount,
      lostCurrency,
      lostReason,
      lostAt: new Date(),
    },
  });
};

type DateRange = { start?: Date; end?: Date };

export const resolveDateRange = (startDate?: string, endDate?: string): DateRange => {
  const parse = (val?: string): Date | undefined => {
    if (!val) return undefined;
    const day = new Date(val);

    return Number.isNaN(day.getTime()) ? undefined : day;
  };

  return { start: parse(startDate), end: parse(endDate) };
};

const inRange = ({ start, end }: DateRange): Prisma.DateTimeFilter | undefined => {
  if (!start && !end) return undefined;
  const filter: Prisma.DateTimeFilter = {};

  if (start) filter.gte = start;
  if (end) filter.lte = end;

  return filter;
};

export const getBdOverview = async (startDate?: string, endDate?: string) => {
  const range = resolveDateRange(startDate, endDate);
  const rangeFilter = inRange(range);

  const lostDateWhere: Prisma.CampaignWhereInput | undefined = rangeFilter
    ? { OR: [{ lostAt: rangeFilter }, { AND: [{ lostAt: null }, { updatedAt: rangeFilter }] }] }
    : undefined;

  const admins = await prisma.admin.findMany({
    select: {
      userId: true,
      role: { select: { name: true } },
      user: { select: { id: true, name: true, photoURL: true } },
    },
  });

  const bdAdmins = admins.filter((a) => isBdRoleName(a.role?.name));
  const nameById = new Map(bdAdmins.map((a) => [a.userId, a.user?.name || 'Unknown']));
  const photoById = new Map(bdAdmins.map((a) => [a.userId, a.user?.photoURL || 'Unknown']));

  const statusGroups = await prisma.campaign.groupBy({
    by: ['draftStatus', 'status'],
    where: { draftStatus: { not: null } },
    _count: { _all: true },
  });
  const stageCount = (status: CampaignDraftStatus) =>
    statusGroups.filter((g) => g.draftStatus === status).reduce((s, g) => s + g._count._all, 0);
  const handedOverActive = statusGroups
    .filter((g) => g.draftStatus === 'HANDED_OVER' && g.status === 'ACTIVE')
    .reduce((s, g) => s + g._count._all, 0);
  const handedOverTotal = stageCount('HANDED_OVER');

  const lostSnapshotCount = await prisma.campaign.count({
    where: { draftStatus: 'LOST', ...(lostDateWhere || {}) },
  });

  const pipeline = [
    { key: 'DRAFTED', label: 'Drafted', count: stageCount('DRAFTED') },
    { key: 'SENT_TO_CLIENT', label: 'Sent', count: stageCount('SENT_TO_CLIENT') },
    { key: 'PENDING_REVIEW', label: 'Pending', count: stageCount('PENDING_REVIEW') },
    { key: 'APPROVED', label: 'Approved', count: stageCount('APPROVED') },
    { key: 'HANDED_OVER', label: 'Handed over', count: handedOverTotal - handedOverActive },
    { key: 'ACTIVE', label: 'Active', count: handedOverActive },
    { key: 'LOST', label: 'Lost', count: lostSnapshotCount },
  ];

  const sentRows = await prisma.campaign.findMany({
    where: {
      draftStatus: { not: null },
      sentToClientAt: rangeFilter ? { ...rangeFilter, not: null } : { not: null },
    },
    select: { briefOwnerId: true },
  });

  const wonRows = await prisma.campaign.findMany({
    where: {
      draftStatus: 'HANDED_OVER',
      handedOverAt: rangeFilter ? { ...rangeFilter, not: null } : { not: null },
    },
    select: { briefOwnerId: true, wonAmount: true, wonCurrency: true },
  });

  const lostRows = await prisma.campaign.findMany({
    where: { draftStatus: 'LOST', ...(lostDateWhere || {}) },
    select: { briefOwnerId: true, lostAmount: true, lostCurrency: true },
  });

  const pendingRows = await prisma.campaign.findMany({
    where: { draftStatus: 'PENDING_REVIEW' },
    select: { briefOwnerId: true },
  });

  type Person = {
    userId: string;
    name: string;
    photoURL: string | null;
    sent: number;
    pending: number;
    converted: number;
    lost: number;
    convRate: number | null;
    value: Record<string, { wonAmount: number; lostAmount: number }>;
  };

  const byUser = new Map<string, Person>();
  const ensure = (uid: string | null): Person => {
    const id = uid || 'unknown';
    if (!byUser.has(id)) {
      byUser.set(id, {
        userId: id,
        name: nameById.get(id) || 'Unknown',
        photoURL: photoById.get(id) || null,
        sent: 0,
        pending: 0,
        converted: 0,
        lost: 0,
        convRate: null,
        value: {},
      });
    }
    return byUser.get(id)!;
  };

  const valueBucket = (p: Person, currency: string | null) => {
    const cur = currency || DEFAULT_CURRENCY;
    if (!p.value[cur]) p.value[cur] = { wonAmount: 0, lostAmount: 0 };
    return p.value[cur];
  };

  sentRows.forEach((r) => {
    ensure(r.briefOwnerId).sent += 1;
  });
  pendingRows.forEach((r) => {
    ensure(r.briefOwnerId).pending += 1;
  });
  wonRows.forEach((r) => {
    const p = ensure(r.briefOwnerId);
    p.converted += 1;
    valueBucket(p, r.wonCurrency).wonAmount += r.wonAmount || 0;
  });
  lostRows.forEach((r) => {
    const p = ensure(r.briefOwnerId);
    p.lost += 1;
    valueBucket(p, r.lostCurrency).lostAmount += r.lostAmount || 0;
  });

  const people = Array.from(byUser.values())
    .map((p) => ({ ...p, convRate: p.sent > 0 ? p.converted / p.sent : null }))
    .filter((p) => p.sent || p.pending || p.converted || p.lost)
    .sort((a, b) => b.converted - a.converted || b.sent - a.sent);

  const currencies = new Set<string>([DEFAULT_CURRENCY, 'SGD']);
  people.forEach((p) => Object.keys(p.value).forEach((c) => currencies.add(c)));
  const valueTotals: Record<string, { wonAmount: number; lostAmount: number }> = {};
  currencies.forEach((c) => {
    valueTotals[c] = { wonAmount: 0, lostAmount: 0 };
  });
  people.forEach((p) =>
    Object.entries(p.value).forEach(([c, v]) => {
      valueTotals[c].wonAmount += v.wonAmount;
      valueTotals[c].lostAmount += v.lostAmount;
    }),
  );

  return {
    range: {
      startDate: range.start ? range.start.toISOString() : null,
      endDate: range.end ? range.end.toISOString() : null,
    },
    currencies: Array.from(currencies),
    pipeline,
    people,
    valueTotals,
  };
};
