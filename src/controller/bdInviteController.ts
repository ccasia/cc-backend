import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { UploadedFile } from 'express-fileupload';
import { generateRandomString } from '@utils/randomString';
import { getUser } from '@services/userServices';
import { bdDraftCreated } from '@configs/nodemailer.config';
import { uploadAttachments } from '@configs/cloudStorage.config';

const prisma = new PrismaClient();

const TOKEN_LENGTH = 24;

const publicUrl = (token: string) => {
  const base = process.env.APP_PUBLIC_URL || 'http://localhost';
  return `${base.replace(/\/$/, '')}/bd/${token}`;
};

const generateUniqueBdToken = async (): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateRandomString(TOKEN_LENGTH);
    const clash = await prisma.admin.findUnique({ where: { bdInviteToken: token } });
    if (!clash) return token;
  }
  throw new Error('Could not generate a unique BD invite token after 5 attempts');
};

// GET /bd/my-invite-link
export const getMyInviteLink = async (req: Request, res: Response) => {
  const userid = req.session.userid;
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

// POST /bd/my-invite-link/rotate
export const rotateMyInviteLink = async (req: Request, res: Response) => {
  const userid = req.session.userid;
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

// GET /bd/invite/public/:token   (no auth)
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

// POST /bd/invite/public/:token/submit   (no auth)
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
  const countrySingle: string =
    typeof body.country === 'string' && body.country.trim() ? body.country.trim() : '';
  const language = toStringArray(body.language);
  const creatorPersona = toStringArray(body.creator_persona);

  // Map the prospect form's human-readable geographic focus labels to the value
  // tokens UpdateAudience expects on the BD edit screen.
  const GEO_FOCUS_LABEL_TO_VALUE: Record<string, string> = {
    'SEA Region': 'SEAregion',
    Global: 'global',
    Others: 'others',
  };

  // Strict server-side validation
  const errors: string[] = [];
  if (!brandName || typeof brandName !== 'string' || brandName.trim().length === 0) errors.push('brandName');
  if (!industry || typeof industry !== 'string') errors.push('industry');
  if (!postingStart && !postingEnd) errors.push('postingTimeline');
  if (!primaryGoal || typeof primaryGoal !== 'string') errors.push('primaryGoal');
  if (secondaryObjectives.length !== 2) {
    errors.push('secondaryObjectives');
  }
  if (kpis.length === 0) {
    errors.push('kpis');
  }
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Invalid submission', invalidFields: errors });
  }

  // File validation — all optional, but strict if present.
  const FILE_MAX = 10 * 1024 * 1024; // 10MB
  const DOC_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

  const pickFile = (key: string): UploadedFile | null => {
    const entry = req.files?.[key];
    if (!entry) return null;
    return Array.isArray(entry) ? entry[0] : entry;
  };

  const brandGuidelinesFile = pickFile('brandGuidelines');

  const validateFile = (file: UploadedFile | null, allowed: Set<string>, label: string): string | null => {
    if (!file) return null;
    if (file.size > FILE_MAX) return `${label} exceeds the 10MB size limit`;
    if (!allowed.has(file.mimetype)) return `${label} must be one of: ${Array.from(allowed).join(', ')}`;
    return null;
  };

  const fileErrors: string[] = [];
  const bgErr = validateFile(brandGuidelinesFile, DOC_MIMES, 'Brand guidelines');
  if (bgErr) fileErrors.push(bgErr);
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

    const startSource = postingStart || postingEnd;
    const endSource = postingEnd || postingStart;
    const start = new Date(startSource);
    const end = new Date(endSource);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid posting dates' });
    }

    // Upload files to GCS BEFORE opening the DB transaction so we don't hold a DB
    // connection open during network I/O. If the DB write fails afterward the
    // uploaded files become orphans, which is acceptable for a lead-capture flow.
    const safeName = (base: string, orig: string) => {
      const ext = orig.includes('.') ? orig.slice(orig.lastIndexOf('.')) : '';
      return `${base}-${generateRandomString(12)}${ext}`;
    };

    let brandGuidelinesUrl: string | null = null;
    if (brandGuidelinesFile) {
      brandGuidelinesUrl = await uploadAttachments({
        tempFilePath: brandGuidelinesFile.tempFilePath,
        fileName: safeName('brand-guidelines', brandGuidelinesFile.name),
        folderName: 'bdInviteAttachments',
      });
    }

    const additionalDetailsData: Record<string, string> = {};
    if (specialNotesInstructions) additionalDetailsData.specialNotesInstructions = specialNotesInstructions;
    if (brandGuidelinesUrl) additionalDetailsData.brandGuidelinesUrl = brandGuidelinesUrl;

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
          submissionVersion: 'v4',
          bdInviteToken: token,
          campaignBrief: {
            create: {
              title: brandName.trim(),
              industries: industry,
              objectives: primaryGoal,
              secondaryObjectives,
              postingStartDate: postingStart ? new Date(postingStart) : null,
              postingEndDate: postingEnd ? new Date(postingEnd) : null,
              startDate: start,
              endDate: end,
              images: ['/assets/images/login/cultimage.png'],
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
