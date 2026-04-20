import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateRandomString } from '@utils/randomString';
import { getUser } from '@services/userServices';
import { bdDraftCreated } from '@configs/nodemailer.config';

const prisma = new PrismaClient();

const TOKEN_LENGTH = 24;

const publicUrl = (token: string) => {
  const base = process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost';
  return `${base.replace(/\/$/, '')}/public/bd/${token}`;
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
export const bdSubmitDraft = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token) return res.status(404).json({ message: 'Not found' });

  const {
    brandName,
    industry,
    postingStart,
    postingEnd,
    primaryGoal,
    secondaryObjectives,
    kpis,
    kpiNotes,
    additionalInfo,
  } = req.body ?? {};

  // Strict server-side validation
  const errors: string[] = [];
  if (!brandName || typeof brandName !== 'string' || brandName.trim().length === 0) errors.push('brandName');
  if (!industry || typeof industry !== 'string') errors.push('industry');
  if (!postingStart && !postingEnd) errors.push('postingTimeline');
  if (!primaryGoal || typeof primaryGoal !== 'string') errors.push('primaryGoal');
  if (!Array.isArray(secondaryObjectives) || secondaryObjectives.length !== 2) {
    errors.push('secondaryObjectives');
  }
  if (!Array.isArray(kpis) || kpis.length === 0) {
    errors.push('kpis');
  }
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Invalid submission', invalidFields: errors });
  }

  try {
    const bdAdmin = await prisma.admin.findUnique({
      where: { bdInviteToken: token },
      include: { user: { select: { id: true, name: true, email: true, status: true } } },
    });

    if (!bdAdmin || !bdAdmin.user || bdAdmin.user.status !== 'active') {
      return res.status(404).json({ message: 'This link is no longer valid' });
    }

    const kpiArray = Array.isArray(kpis) ? kpis.filter((k) => typeof k === 'string') : [];
    const objectiveArray = (secondaryObjectives as unknown[]).filter(
      (s): s is string => typeof s === 'string',
    );

    const description =
      typeof additionalInfo === 'string' && additionalInfo.trim() ? additionalInfo.trim() : '';

    const specialNotesParts: string[] = [];
    if (kpiArray.length) {
      specialNotesParts.push(`KPIs: ${kpiArray.join(', ')}`);
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
              secondaryObjectives: objectiveArray,
              postingStartDate: postingStart ? new Date(postingStart) : null,
              postingEndDate: postingEnd ? new Date(postingEnd) : null,
              startDate: start,
              endDate: end,
              images: ['/assets/images/login/cultimage.png'],
            },
          },
          campaignRequirement: {
            create: {
              user_persona: '',
            },
          },
          ...(specialNotesInstructions
            ? {
                campaignAdditionalDetails: {
                  create: { specialNotesInstructions },
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
