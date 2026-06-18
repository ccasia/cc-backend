import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { UploadedFile } from 'express-fileupload';
import { generateRandomString } from '@utils/randomString';
import { getUser } from '@services/userServices';
import {
  bdDraftCreated,
  briefSentToClient,
  briefApprovedByClient,
  briefHandedOver,
} from '@configs/nodemailer.config';
import { uploadAttachments } from '@configs/cloudStorage.config';
import { classifyBriefRole } from '@utils/briefRoles';
import {
  createDraftBrief,
  updateDraftBrief,
  sendBriefToClient as svcSendBriefToClient,
  approveBriefByBd as svcApproveBriefByBd,
  approveBriefByClient as svcApproveBriefByClient,
  handoverBrief as svcHandoverBrief,
  assignCsmToBrief as svcAssignCsmToBrief,
  deleteBrief as svcDeleteBrief,
  listBriefs as svcListBriefs,
  getBriefById as svcGetBriefById,
  getBriefByMagicToken as svcGetBriefByMagicToken,
  listCslUsers as svcListCslUsers,
  addBriefAttachmentUrl as svcAddBriefAttachmentUrl,
  removeBriefAttachmentUrl as svcRemoveBriefAttachmentUrl,
  snapshotPublicSubmission as svcSnapshotPublicSubmission,
  resetBriefToSnapshot as svcResetBriefToSnapshot,
  BRIEF_ATTACHMENT_MAX,
} from '@services/campaignBriefService';

const prisma = new PrismaClient();

const clientPublicUrl = (magicToken: string) => {
  const base = process.env.APP_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost';
  return `${base.replace(/\/$/, '')}/campaign-brief/client/${magicToken}`;
};

const TOKEN_LENGTH = 24;

const publicUrl = (token: string) => {
  const base = process.env.APP_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost';
  return `${base.replace(/\/$/, '')}/campaign-brief/${token}`;
};

const generateUniqueBdToken = async (): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateRandomString(TOKEN_LENGTH);
    const clash = await prisma.admin.findUnique({ where: { bdInviteToken: token } });
    if (!clash) return token;
  }
  throw new Error('Could not generate a unique BD invite token after 5 attempts');
};

// GET /briefs/my-invite-link
export const getMyInviteLink = async (req: Request, res: Response) => {
  const userid = req.userId;
  if (!userid) return res.status(401).json({ message: 'User not authenticated' });

  try {
    const user = await getUser(userid);
    if (!user?.admin) return res.status(403).json({ message: 'Admin record not found' });

    let token = user.admin.bdInviteToken;
    if (!token) {
      token = await generateUniqueBdToken();
      await prisma.admin.update({
        where: { userId: userid },
        data: { bdInviteToken: token },
      });
    }

    return res.status(200).json({
      token,
      url: publicUrl(token),
    });
  } catch (error) {
    console.error('getMyInviteLink error:', error);
    return res.status(500).json({ message: 'Failed to fetch invite link' });
  }
};

// POST /briefs/my-invite-link/rotate
export const rotateMyInviteLink = async (req: Request, res: Response) => {
  const userid = req.userId;
  if (!userid) return res.status(401).json({ message: 'User not authenticated' });

  try {
    const token = await generateUniqueBdToken();
    await prisma.admin.update({
      where: { userId: userid },
      data: { bdInviteToken: token },
    });
    return res.status(200).json({
      token,
      url: publicUrl(token),
    });
  } catch (error) {
    console.error('rotateMyInviteLink error:', error);
    return res.status(500).json({ message: 'Failed to rotate invite link' });
  }
};

// GET /briefs/invite/public/:token   (no auth)
export const getPublicInviteInfo = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token) return res.status(404).json({ message: 'Not found' });

  try {
    const bdAdmin = await prisma.admin.findUnique({
      where: { bdInviteToken: token },
      include: { user: { select: { id: true, name: true, status: true } } },
    });

    if (!bdAdmin || !bdAdmin.user || bdAdmin.user.status !== 'active') {
      return res.status(404).json({ message: 'This link is no longer valid' });
    }

    return res.status(200).json({
      bdName: bdAdmin.user.name,
    });
  } catch (error) {
    console.error('getPublicInviteInfo error:', error);
    return res.status(500).json({ message: 'Failed to load invite' });
  }
};

// POST /briefs/invite/public/:token/submit   (no auth)
//
// Accepts either application/json or multipart/form-data. When a brandGuidelines
// file is present the client must use multipart — in that case array-typed fields
// (secondaryObjectives, kpis) arrive as JSON strings.
export const bdSubmitDraft = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token) return res.status(404).json({ message: 'Not found' });

  // Normalize array fields: JSON posts send arrays, multipart posts send strings.
  const toStringArray = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
      } catch {
        // not JSON — treat as a single value
        return [raw];
      }
    }
    return [];
  };

  const body = req.body ?? {};
  const {
    brandName,
    industry,
    postingStart,
    postingEnd,
    primaryGoal,
    kpiNotes,
    additionalInfo,
    // Optional primary audience (CampaignRequirement)
    user_persona: userPersona,
    geographic_focus: geographicFocus,
  } = body;

  const secondaryObjectives = toStringArray(body.secondaryObjectives);
  const kpis = toStringArray(body.kpis);
  const gender = toStringArray(body.gender);
  const age = toStringArray(body.age);
  const countrySingle: string = typeof body.country === 'string' && body.country.trim() ? body.country.trim() : '';
  const language = toStringArray(body.language);
  const creatorPersona = toStringArray(body.creator_persona);

  // Map the prospect form's human-readable geographic focus labels to the value
  // tokens UpdateAudience expects on the BD edit screen.
  const GEO_FOCUS_LABEL_TO_VALUE: Record<string, string> = {
    'SEA Region': 'SEAregion',
    Global: 'global',
    Others: 'others',
  };

  // Prospects may submit an incomplete brief — only a brand name is required so
  // the lead is identifiable. Everything else (dates, objectives, KPIs,
  // audience) is optional and filled with safe defaults on create.
  const errors: string[] = [];
  if (!brandName || typeof brandName !== 'string' || brandName.trim().length === 0) errors.push('brandName');
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Invalid submission', invalidFields: errors });
  }

  // File validation — all optional, but strict if present. Up to
  // BRIEF_ATTACHMENT_MAX attachments, sent under the `brandGuidelines` field.
  const FILE_MAX = 25 * 1024 * 1024; // 25MB
  const DOC_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

  const pickFiles = (key: string): UploadedFile[] => {
    const entry = req.files?.[key];
    if (!entry) return [];
    return Array.isArray(entry) ? entry : [entry];
  };

  const attachmentFiles = pickFiles('brandGuidelines');

  const fileErrors: string[] = [];
  if (attachmentFiles.length > BRIEF_ATTACHMENT_MAX) {
    fileErrors.push(`You can attach at most ${BRIEF_ATTACHMENT_MAX} files`);
  }
  for (const file of attachmentFiles) {
    if (file.size > FILE_MAX) fileErrors.push(`${file.name} exceeds the 25MB size limit`);
    else if (!DOC_MIMES.has(file.mimetype)) fileErrors.push(`${file.name} must be PDF, JPG, or PNG`);
  }
  if (fileErrors.length > 0) {
    return res.status(400).json({ message: 'Invalid file upload', fileErrors });
  }

  try {
    const bdAdmin = await prisma.admin.findUnique({
      where: { bdInviteToken: token },
      include: { user: { select: { id: true, name: true, email: true, status: true } } },
    });

    if (!bdAdmin || !bdAdmin.user || bdAdmin.user.status !== 'active') {
      return res.status(404).json({ message: 'This link is no longer valid' });
    }

    const description = typeof additionalInfo === 'string' && additionalInfo.trim() ? additionalInfo.trim() : '';

    const specialNotesParts: string[] = [];
    if (kpis.length) {
      specialNotesParts.push(`KPIs: ${kpis.join(', ')}`);
    }
    if (typeof kpiNotes === 'string' && kpiNotes.trim()) {
      specialNotesParts.push(`KPI notes: ${kpiNotes.trim()}`);
    }
    const specialNotesInstructions = specialNotesParts.join('\n\n') || null;

    // Dates are optional on an incomplete brief. CampaignBrief requires
    // startDate/endDate columns, so fall back to "now" when the prospect didn't
    // supply a posting window. The nullable postingStartDate/postingEndDate below
    // still reflect what they actually entered (or null).
    const startSource = postingStart || postingEnd;
    const endSource = postingEnd || postingStart;
    const parsedStart = startSource ? new Date(startSource) : null;
    const parsedEnd = endSource ? new Date(endSource) : null;
    if (
      (parsedStart && Number.isNaN(parsedStart.getTime())) ||
      (parsedEnd && Number.isNaN(parsedEnd.getTime()))
    ) {
      return res.status(400).json({ message: 'Invalid posting dates' });
    }
    const now = new Date();
    const start = parsedStart || now;
    const end = parsedEnd || now;

    // Upload files to GCS BEFORE opening the DB transaction so we don't hold a DB
    // connection open during network I/O. If the DB write fails afterward the
    // uploaded files become orphans, which is acceptable for a lead-capture flow.
    const safeName = (base: string, orig: string) => {
      const ext = orig.includes('.') ? orig.slice(orig.lastIndexOf('.')) : '';
      return `${base}-${generateRandomString(12)}${ext}`;
    };

    const attachmentUrls: string[] = [];
    for (const file of attachmentFiles) {
      const url = await uploadAttachments({
        tempFilePath: file.tempFilePath,
        fileName: safeName('brief-attachment', file.name),
        folderName: 'bdInviteAttachments',
      });
      attachmentUrls.push(url);
    }

    const additionalDetailsData: Record<string, string> = {};
    if (specialNotesInstructions) additionalDetailsData.specialNotesInstructions = specialNotesInstructions;

    const requirementData: Record<string, unknown> = {
      user_persona: typeof userPersona === 'string' ? userPersona : '',
    };
    if (gender.length) requirementData.gender = gender;
    if (age.length) requirementData.age = age;
    if (countrySingle) requirementData.country = countrySingle;
    if (language.length) requirementData.language = language;
    if (creatorPersona.length) requirementData.creator_persona = creatorPersona;
    if (typeof geographicFocus === 'string' && geographicFocus.trim()) {
      const raw = geographicFocus.trim();
      requirementData.geographic_focus = GEO_FOCUS_LABEL_TO_VALUE[raw] ?? raw;
    }

    const campaign = await prisma.$transaction(async (tx) => {
      return tx.campaign.create({
        data: {
          name: brandName.trim(),
          description,
          status: 'DRAFT',
          origin: 'CLIENT',
          // Surface the submission in the BD's Campaign Brief list awaiting their
          // review. The BD can edit fields, then approve → handover.
          draftStatus: 'PENDING_REVIEW',
          draftOrigin: 'CLIENT_INVITED',
          submissionVersion: 'v4',
          briefOwnerId: bdAdmin.userId,
          bdInviteToken: token,
          campaignBrief: {
            create: {
              title: brandName.trim(),
              industries: typeof industry === 'string' ? industry : '',
              objectives: typeof primaryGoal === 'string' ? primaryGoal : '',
              secondaryObjectives,
              postingStartDate: parsedStart,
              postingEndDate: parsedEnd,
              startDate: start,
              endDate: end,
              images: ['/assets/images/login/cultimage.png'],
              otherAttachments: attachmentUrls,
            },
          },
          campaignRequirement: {
            create: requirementData as any,
          },
          ...(Object.keys(additionalDetailsData).length > 0
            ? {
                campaignAdditionalDetails: {
                  create: additionalDetailsData,
                },
              }
            : {}),
          campaignAdmin: {
            create: {
              adminId: bdAdmin.userId,
              role: 'owner',
            },
          },
        },
      });
    });

    // Capture the as-submitted values as the BD's reset baseline. Best-effort —
    // a failure here shouldn't fail the prospect's submission.
    await svcSnapshotPublicSubmission(campaign.id).catch((err) =>
      console.error('snapshotPublicSubmission failed:', err),
    );

    // Fire-and-forget notification email to the BD. Don't block the response on email delivery.
    if (bdAdmin.user.email) {
      bdDraftCreated({
        to: bdAdmin.user.email,
        bdName: bdAdmin.user.name || 'there',
        brandName: brandName.trim(),
        campaignId: campaign.id,
      }).catch((err) => console.error('bdDraftCreated email failed:', err));
    }

    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('submitPublicInvite error:', error);
    return res.status(500).json({ message: 'Failed to submit brief' });
  }
};

// =============================================================================
// BD-authored Campaign Brief flow
// =============================================================================

// POST /briefs
export const createBrief = async (req: Request, res: Response) => {
  const userid = req.userId;
  if (!userid) return res.status(401).json({ message: 'User not authenticated' });
  try {
    const brief = await createDraftBrief(userid);
    return res.status(201).json({ id: brief.id });
  } catch (error) {
    console.error('createBrief error:', error);
    return res.status(500).json({ message: 'Failed to create brief' });
  }
};

// GET /briefs
export const listBriefs = async (req: Request, res: Response) => {
  const userid = req.userId;
  if (!userid) return res.status(401).json({ message: 'User not authenticated' });
  try {
    const user = await getUser(userid);
    const briefs = await svcListBriefs(user as any, userid);
    const withLinks = briefs.map((b: any) => {
      const { clientMagicToken, clientTokenExpiresAt, ...rest } = b;
      const expired = clientTokenExpiresAt && new Date(clientTokenExpiresAt) < new Date();
      return {
        ...rest,
        clientLink: clientMagicToken && !expired ? clientPublicUrl(clientMagicToken) : null,
      };
    });
    return res.status(200).json(withLinks);
  } catch (error) {
    console.error('listBriefs error:', error);
    return res.status(500).json({ message: 'Failed to list briefs' });
  }
};

// GET /briefs/:id
export const getBrief = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const brief = await svcGetBriefById(id);
    if (!brief) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json(brief);
  } catch (error) {
    console.error('getBrief error:', error);
    return res.status(500).json({ message: 'Failed to load brief' });
  }
};

// PATCH /briefs/:id
export const patchBrief = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const updated = await updateDraftBrief(id, req.body || {}, 'bd');
    return res.status(200).json({ id: updated.id, draftStatus: updated.draftStatus });
  } catch (error: any) {
    console.error('patchBrief error:', error);
    if (/transition|not found/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to update brief' });
  }
};

// POST /briefs/:id/send
export const sendBriefToClient = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { clientName, clientEmail } = req.body || {};
  if (typeof clientName !== 'string' || !clientName.trim()) {
    return res.status(400).json({ message: 'clientName is required' });
  }
  if (typeof clientEmail !== 'string' || !clientEmail.trim()) {
    return res.status(400).json({ message: 'clientEmail is required' });
  }
  try {
    const updated = await svcSendBriefToClient(id, clientName.trim(), clientEmail.trim());
    const link = clientPublicUrl(updated.clientMagicToken as string);

    briefSentToClient({
      to: clientEmail.trim(),
      clientName: clientName.trim(),
      brandName: updated.name,
      link,
    }).catch((err) => console.error('briefSentToClient email failed:', err));

    return res.status(200).json({ id: updated.id, link });
  } catch (error: any) {
    console.error('sendBriefToClient error:', error);
    if (/transition|not found/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to send brief' });
  }
};

// POST /briefs/:id/approve  (BD/admin approves an incoming brief)
export const approveBrief = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const updated = await svcApproveBriefByBd(id);
    return res.status(200).json({ id: updated.id, draftStatus: updated.draftStatus });
  } catch (error: any) {
    console.error('approveBrief error:', error);
    if (/transition|not found/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to approve brief' });
  }
};

// POST /briefs/:id/reset
//
// Reverts a brief's editable fields back to its stored snapshot. For a
// PENDING_REVIEW (CLIENT_INVITED) brief this restores the original prospect
// submission — the BD-side analogue of the client's reset-to-sent-snapshot.
// Returns the refreshed brief so the frontend can reseed the form.
export const resetBrief = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await svcResetBriefToSnapshot(id);
    const brief = await svcGetBriefById(id);
    return res.status(200).json(brief);
  } catch (error: any) {
    console.error('resetBrief error:', error);
    if (/snapshot|not found/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to reset brief' });
  }
};

// POST /briefs/:id/handover
//
// Hands the brief over to the CSL (CS Lead) group. There is no individual CS
// picker — CSL is responsible for assigning a specific CS member afterward.
export const handoverBrief = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { internalComments } = req.body || {};
  const notes = typeof internalComments === 'string' && internalComments.trim()
    ? internalComments.trim()
    : null;

  // A handover-ready brief must already have a company linked (with an active
  // package). The HandoverDialog orchestrates company/package creation via
  // their dedicated endpoints before calling this one.
  const linked = await prisma.campaign.findUnique({
    where: { id },
    select: {
      companyId: true,
      brandId: true,
      company: { select: { name: true, subscriptions: { where: { status: 'ACTIVE' }, select: { id: true } } } },
      brand: { select: { name: true, company: { select: { subscriptions: { where: { status: 'ACTIVE' }, select: { id: true } } } } } },
    },
  });
  if (!linked || (!linked.companyId && !linked.brandId)) {
    return res.status(400).json({ message: 'Link a company before handing over the brief.' });
  }
  const activeSubs =
    linked.company?.subscriptions?.length || linked.brand?.company?.subscriptions?.length || 0;
  if (activeSubs === 0) {
    return res.status(400).json({ message: 'Attach an active package to the company before handover.' });
  }
  const displayName = linked.company?.name || linked.brand?.name || null;

  try {
    const updated = await svcHandoverBrief(id, displayName, notes);

    // Notify every CSL user.
    const csls = await svcListCslUsers();
    for (const csl of csls) {
      const email = csl.user?.email;
      if (!email) continue;
      briefHandedOver({
        to: email,
        csName: csl.user?.name || 'there',
        brandName: updated.name,
        briefId: updated.id,
        internalComments: notes,
      }).catch((err) => console.error('briefHandedOver email failed:', err));
    }

    return res.status(200).json({ id: updated.id, draftStatus: updated.draftStatus });
  } catch (error: any) {
    console.error('handoverBrief error:', error);
    if (/transition|not found|No CSL/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to hand over brief' });
  }
};

// POST /briefs/:id/assign-csm
//
// CSL (or superadmin) assigns one or more CSMs to a handed-over campaign. This
// is assignment only — the campaign stays PENDING_ADMIN_ACTIVATION and the CSM
// completes activation later. Body: { csmIds: string[] }.
export const assignCsm = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userid = req.userId;
  if (!userid) return res.status(401).json({ message: 'User not authenticated' });

  try {
    const user = await getUser(userid);
    const role = classifyBriefRole(user as any);
    if (role !== 'CSL' && role !== 'superadmin') {
      return res.status(403).json({ message: 'Only CSL can assign CSMs.' });
    }

    const { csmIds } = req.body || {};
    if (!Array.isArray(csmIds) || csmIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one CSM to assign.' });
    }

    const updated = await svcAssignCsmToBrief(id, csmIds);
    return res.status(200).json(updated);
  } catch (error: any) {
    console.error('assignCsm error:', error);
    if (/not found|handed-over|CSM|at least one/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to assign CSM' });
  }
};

// POST /briefs/:id/attachments  (multipart, BD)
export const uploadBriefAttachment = async (req: Request, res: Response) => {
  const { id } = req.params;
  return handleBriefAttachmentUpload(req, res, async () => {
    const brief = await svcGetBriefById(id);
    if (!brief) return null;
    return brief.id;
  });
};

// POST /briefs/public/:magicToken/attachments  (multipart, public)
export const uploadBriefAttachmentPublic = async (req: Request, res: Response) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const { magicToken } = req.params;
  return handleBriefAttachmentUpload(req, res, async () => {
    const brief = await svcGetBriefByMagicToken(magicToken);
    return brief?.id || null;
  });
};

// DELETE /briefs/:id/attachments?url=...  (BD)
// Removes a single attachment when `url` is provided, otherwise clears all.
export const deleteBriefAttachment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const url = typeof req.query.url === 'string' ? req.query.url : undefined;
  try {
    const brief = await svcGetBriefById(id);
    if (!brief) return res.status(404).json({ message: 'Not found' });
    const attachments = await svcRemoveBriefAttachmentUrl(brief.id, url);
    return res.status(200).json({ ok: true, attachments });
  } catch (error) {
    console.error('deleteBriefAttachment error:', error);
    return res.status(500).json({ message: 'Failed to delete attachment' });
  }
};

// DELETE /briefs/public/:magicToken/attachments?url=...  (public)
export const deleteBriefAttachmentPublic = async (req: Request, res: Response) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const { magicToken } = req.params;
  const url = typeof req.query.url === 'string' ? req.query.url : undefined;
  try {
    const brief = await svcGetBriefByMagicToken(magicToken);
    if (!brief) return res.status(404).json({ message: 'This link is no longer valid' });
    const attachments = await svcRemoveBriefAttachmentUrl(brief.id, url);
    return res.status(200).json({ ok: true, attachments });
  } catch (error) {
    console.error('deleteBriefAttachmentPublic error:', error);
    return res.status(500).json({ message: 'Failed to delete attachment' });
  }
};

const BRIEF_FILE_MAX = 25 * 1024 * 1024; // 25 MB
const BRIEF_DOC_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

const handleBriefAttachmentUpload = async (
  req: Request,
  res: Response,
  resolveBriefId: () => Promise<string | null>,
) => {
  try {
    const briefId = await resolveBriefId();
    if (!briefId) return res.status(404).json({ message: 'Not found' });

    const entry = req.files?.brandGuidelines;
    const file = (Array.isArray(entry) ? entry[0] : entry) as UploadedFile | undefined;
    if (!file) return res.status(400).json({ message: 'An attachment file is required' });

    if (file.size > BRIEF_FILE_MAX) {
      return res.status(400).json({ message: 'Attachment exceeds the 25MB size limit' });
    }
    if (!BRIEF_DOC_MIMES.has(file.mimetype)) {
      return res.status(400).json({ message: 'Attachment must be PDF, JPG, or PNG' });
    }

    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const safeName = `brief-attachment-${generateRandomString(12)}${ext}`;

    const url = await uploadAttachments({
      tempFilePath: file.tempFilePath,
      fileName: safeName,
      folderName: 'campaignBriefAttachments',
    });

    try {
      const attachments = await svcAddBriefAttachmentUrl(briefId, url);
      return res.status(200).json({ url, attachments });
    } catch (err: any) {
      if (err?.code === 'ATTACHMENT_LIMIT') {
        return res
          .status(400)
          .json({ message: `You can attach at most ${BRIEF_ATTACHMENT_MAX} files` });
      }
      throw err;
    }
  } catch (error) {
    console.error('uploadBriefAttachment error:', error);
    return res.status(500).json({ message: 'Failed to upload attachment' });
  }
};

// DELETE /briefs/:id
export const deleteBrief = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await svcDeleteBrief(id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('deleteBrief error:', error);
    return res.status(500).json({ message: 'Failed to delete brief' });
  }
};

// =============================================================================
// Public (magic-link) endpoints for the client review/edit/approve flow
// =============================================================================

// GET /briefs/public/:magicToken
export const getBriefPublic = async (req: Request, res: Response) => {
  const { magicToken } = req.params;
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const brief = await svcGetBriefByMagicToken(magicToken);
    if (!brief) return res.status(404).json({ message: 'This link is no longer valid' });
    return res.status(200).json(brief);
  } catch (error) {
    console.error('getBriefPublic error:', error);
    return res.status(500).json({ message: 'Failed to load brief' });
  }
};

// PATCH /briefs/public/:magicToken
export const patchBriefPublic = async (req: Request, res: Response) => {
  const { magicToken } = req.params;
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const brief = await svcGetBriefByMagicToken(magicToken);
    if (!brief) return res.status(404).json({ message: 'This link is no longer valid' });

    await updateDraftBrief(brief.id, req.body || {}, 'client');
    // Re-fetch the full nested brief so the frontend can refresh its in-memory
    // copy. Returning just editedByClientFields leaves the rest of the brief
    // state stale and the form can revert when it reseeds from a partial
    // payload.
    const refreshed = await svcGetBriefByMagicToken(magicToken);
    return res.status(200).json(refreshed);
  } catch (error: any) {
    console.error('patchBriefPublic error:', error);
    if (/may not edit|transition|not found/i.test(error?.message || '')) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to save changes' });
  }
};

// POST /briefs/public/:magicToken/approve
export const approveBriefPublic = async (req: Request, res: Response) => {
  const { magicToken } = req.params;
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const updated = await svcApproveBriefByClient(magicToken);

    // Notify the BD owner.
    const owner = await prisma.campaignAdmin.findFirst({
      where: { campaignId: updated.id, role: 'owner' },
      include: { admin: { include: { user: { select: { email: true, name: true } } } } },
    });
    if (owner?.admin?.user?.email) {
      briefApprovedByClient({
        to: owner.admin.user.email,
        bdName: owner.admin.user.name || 'there',
        brandName: updated.name,
        briefId: updated.id,
        clientName: updated.clientName || '',
      }).catch((err) => console.error('briefApprovedByClient email failed:', err));
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('approveBriefPublic error:', error);
    if (/transition|not found/i.test(error?.message || '')) {
      return res.status(404).json({ message: 'This link is no longer valid' });
    }
    return res.status(500).json({ message: 'Failed to approve brief' });
  }
};
