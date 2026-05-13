import crypto from 'crypto';
import jwt, { Secret } from 'jsonwebtoken';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

import { sendCreatorApprovalListEmail, type ApprovalListEmailCreatorRow } from '@configs/nodemailer.config';

import { io } from '../server';

const prisma = new PrismaClient();

function formatFollowersShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

/** Minimal URL extraction for email display (aligned with app media-kit-utils). */
function extractUsernameFromProfileLink(link: string | null | undefined): string | null {
  if (!link || typeof link !== 'string') return null;
  const trimmed = link.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (host.includes('instagram.com') && parts[0]) {
      const h = parts[0].replace(/^@/, '');
      if (h && !['p', 'reel', 'reels', 'stories', 'explore'].includes(h.toLowerCase())) return h;
    }
    if (host.includes('tiktok.com')) {
      const seg = parts.find((p) => p && p !== 'video' && !/^\d+$/.test(p));
      if (seg) return seg.replace(/^@/, '');
    }
  } catch {
    /* ignore */
  }
  const ig = trimmed.match(/instagram\.com\/([^/?#]+)/i);
  if (ig?.[1] && !['p', 'reel', 'reels'].includes(ig[1].toLowerCase())) return ig[1].replace(/^@/, '');
  const tk = trimmed.match(/tiktok\.com\/@?([^/?#]+)/i);
  if (tk?.[1]) return tk[1].replace(/^@/, '');
  return null;
}

function buildApprovalEmailCreatorRow(pitch: {
  followerCount: string | null;
  user: {
    name: string | null;
    photoURL: string | null;
    creator: {
      manualFollowerCount: number | null;
      instagramProfileLink: string | null;
      tiktokProfileLink: string | null;
      instagramUser: { username: string | null; followers_count: number | null } | null;
      tiktokUser: { username: string | null; follower_count: number | null } | null;
      creditTier: { name: string | null; creditsPerVideo: number | null } | null;
    } | null;
  } | null;
}): ApprovalListEmailCreatorRow {
  const user = pitch.user;
  const creator = user?.creator;
  const ig = creator?.instagramUser;
  const tk = creator?.tiktokUser;
  const igUser = ig?.username || extractUsernameFromProfileLink(creator?.instagramProfileLink ?? undefined);
  const tkUser = tk?.username || extractUsernameFromProfileLink(creator?.tiktokProfileLink ?? undefined);

  const followerRaw = pitch.followerCount ?? creator?.manualFollowerCount ?? ig?.followers_count ?? tk?.follower_count;
  let followerDisplay = '-';
  if (followerRaw !== null && followerRaw !== undefined && String(followerRaw).trim() !== '') {
    const n = Number(followerRaw);
    if (Number.isFinite(n)) followerDisplay = formatFollowersShort(n);
  }

  const tierName = creator?.creditTier?.name ?? '-';
  const credits = creator?.creditTier?.creditsPerVideo ?? '-';
  const statsLine = `${followerDisplay} Followers | ${tierName} (${credits} Credits)`;

  const name = user?.name || 'Creator';
  const photo = user?.photoURL;
  let profilePicUrl: string;
  if (photo && /^https?:\/\//i.test(photo.trim())) {
    profilePicUrl = photo.trim();
  } else {
    profilePicUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name.slice(0, 40))}&size=128&background=E5E5EA&color=221F20&bold=true`;
  }

  return {
    name,
    profilePicUrl,
    instagramDisplay: igUser ? `@${String(igUser).replace(/^@/, '')}` : null,
    tiktokDisplay: tkUser ? `@${String(tkUser).replace(/^@/, '')}` : null,
    statsLine,
  };
}

// POST /api/approval-requests
// Creates an approval request for selected pitches, provisions a client account for the approver
export const createApprovalRequest = async (req: Request, res: Response) => {
  const { campaignId, approverName, approverEmail, pitchIds } = req.body;

  if (!campaignId || !approverName || !approverEmail || !Array.isArray(pitchIds) || pitchIds.length === 0) {
    return res.status(400).json({ message: 'campaignId, approverName, approverEmail, and pitchIds are required' });
  }

  const validPitchIds = pitchIds.filter((id: unknown) => typeof id === 'string' && id.length > 0);
  if (validPitchIds.length === 0) {
    return res
      .status(400)
      .json({ message: 'No valid pitch IDs provided. Please re-select the creators and try again.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(approverEmail)) {
    return res.status(400).json({ message: 'Invalid approver email' });
  }

  try {
    const pitches = await prisma.pitch.findMany({
      where: { id: { in: validPitchIds }, campaignId },
    });

    if (pitches.length !== validPitchIds.length) {
      return res.status(400).json({ message: 'One or more pitches do not belong to this campaign' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    // const expiresAt = new Date(Date.now() + 5 * 1000); // 5 seconds

    let inviteToken: string | null = null;
    const existingUser = await prisma.user.findFirst({
      where: { email: approverEmail.toLowerCase() },
      include: { client: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      let clientId: string | null = null;

      let clientRole = await tx.role.findFirst({ where: { name: 'Client' } });
      if (!clientRole) {
        clientRole = await tx.role.create({ data: { name: 'Client' } });
      }

      if (!existingUser) {
        // Case 1: Brand-new user — create User + Admin + Client + inviteToken
        const newUser = await tx.user.create({
          data: {
            email: approverEmail.toLowerCase(),
            password: '',
            role: 'client',
            status: 'pending',
            name: approverName,
          },
        });

        await tx.admin.create({
          data: { userId: newUser.id, roleId: clientRole.id, mode: 'normal' },
        });

        inviteToken = jwt.sign({ id: newUser.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '7d' });

        const newClient = await tx.client.create({
          data: { userId: newUser.id, inviteToken },
        });

        clientId = newClient.id;

        await tx.campaignClient.create({
          data: { clientId: newClient.id, campaignId, role: 'approver' },
        });
      } else if (!existingUser.client) {
        // Case 2: User exists (e.g. creator/admin) but has no Client record — create one
        const existingAdmin = await tx.admin.findUnique({ where: { userId: existingUser.id } });
        if (!existingAdmin) {
          await tx.admin.create({
            data: { userId: existingUser.id, roleId: clientRole.id, mode: 'normal' },
          });
        }

        inviteToken = jwt.sign({ id: existingUser.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '7d' });

        const newClient = await tx.client.create({
          data: { userId: existingUser.id, inviteToken },
        });

        clientId = newClient.id;

        await tx.campaignClient.create({
          data: { clientId: newClient.id, campaignId, role: 'approver' },
        });
      } else {
        // Case 3: Existing client user
        clientId = existingUser.client.id;

        if (existingUser.status === 'pending') {
          // Case 3a: Hasn't set up a password yet — issue a fresh inviteToken so they can
          inviteToken = jwt.sign({ id: existingUser.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '7d' });

          await tx.client.update({
            where: { id: existingUser.client.id },
            data: { inviteToken },
          });
        }
        // Case 3b: Already active (has password) — inviteToken stays null,
        // frontend will show "Log In" prompt instead of "Set Up Password"

        await tx.campaignClient.upsert({
          where: { clientId_campaignId: { clientId: existingUser.client.id, campaignId } },
          create: { clientId: existingUser.client.id, campaignId, role: 'approver' },
          update: { role: 'approver' },
        });
      }

      // Create the ApprovalRequest
      const approvalRequest = await tx.approvalRequest.create({
        data: {
          token,
          campaignId,
          approverName,
          approverEmail: approverEmail.toLowerCase(),
          inviteToken,
          expiresAt,
          creators: {
            create: validPitchIds.map((pitchId: string) => ({ pitchId })),
          },
        },
      });

      await tx.pitch.updateMany({
        where: { id: { in: validPitchIds } },
        data: { status: 'AWAITING_APPROVAL' },
      });

      return approvalRequest;
    });

    const senderIdForLog = (req as any).session?.userid as string | undefined;
    try {
      const count = validPitchIds.length;
      const countLabel = `${count} creator${count === 1 ? '' : 's'}`;
      await prisma.campaignLog.create({
        data: {
          campaignId,
          ...(senderIdForLog ? { adminId: senderIdForLog } : {}),
          message: `sent creator shortlist for approval to approver ${approverName.trim()} (${countLabel})`,
        },
      });
    } catch (logErr) {
      console.error('Failed to write campaign log for approval request:', logErr);
    }

    const baseUrl = process.env.BASE_EMAIL_URL || 'http://localhost:3000';
    const link = `${baseUrl}/public/approval/${token}`;

    const approverNeedsSetup = inviteToken !== null;

    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { name: true },
      });
      const pitchesForEmail = await prisma.pitch.findMany({
        where: { id: { in: validPitchIds } },
        include: {
          user: {
            select: {
              name: true,
              photoURL: true,
              creator: {
                select: {
                  manualFollowerCount: true,
                  instagramProfileLink: true,
                  tiktokProfileLink: true,
                  instagramUser: {
                    select: { username: true, followers_count: true },
                  },
                  tiktokUser: {
                    select: { username: true, follower_count: true },
                  },
                  creditTier: {
                    select: { name: true, creditsPerVideo: true },
                  },
                },
              },
            },
          },
        },
      });
      const pitchById = new Map(pitchesForEmail.map((p) => [p.id, p]));
      const orderedPitches = validPitchIds
        .map((id) => pitchById.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));

      const creatorsPayload = orderedPitches.map((p) => buildApprovalEmailCreatorRow(p));

      const senderId = (req as any).session?.userid as string | undefined;
      const senderUser = senderId
        ? await prisma.user.findUnique({ where: { id: senderId }, select: { name: true } })
        : null;
      const senderName = senderUser?.name?.trim() || undefined;

      await sendCreatorApprovalListEmail({
        to: approverEmail.toLowerCase(),
        approverName,
        senderName,
        campaignName: campaign?.name || 'Campaign',
        approvalLink: link,
        creators: creatorsPayload,
      });
    } catch (emailErr) {
      console.error('Failed to send creator approval list email:', emailErr);
    }

    return res.status(201).json({ token, link, approverNeedsSetup });
  } catch (error: any) {
    console.error('Error creating approval request:', error);
    return res.status(500).json({
      message: 'Error creating approval request',
      detail: process.env.NODE_ENV !== 'production' ? error?.message : undefined,
    });
  }
};

export const getApprovalRequest = async (req: Request, res: Response) => {
  const { token } = req.params;

  try {
    const approvalRequest = await prisma.approvalRequest.findUnique({
      where: { token },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            brand: {
              select: { name: true, logo: true },
            },
            company: {
              select: { name: true, logo: true },
            },
            campaignBrief: {
              select: {
                images: true,
              },
            },
          },
        },
        creators: {
          include: {
            pitch: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    photoURL: true,
                    creator: {
                      select: {
                        instagramUser: true,
                        tiktokUser: true,
                        manualFollowerCount: true,
                        creditTier: {
                          select: {
                            name: true,
                            creditsPerVideo: true,
                          },
                        },
                        profileLink: true,
                        instagramProfileLink: true,
                        tiktokProfileLink: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!approvalRequest) {
      return res.status(404).json({ message: 'Approval request not found' });
    }

    if (new Date() > approvalRequest.expiresAt) {
      return res.status(410).json({ message: 'This approval link has expired' });
    }

    return res.status(200).json(approvalRequest);
  } catch (error) {
    console.error('Error fetching approval request:', error);
    return res.status(500).json({ message: 'Error fetching approval request' });
  }
};

const APPROVAL_COMMENT_MAX_LEN = 5000;

// PATCH /api/approval-requests/:token/creators/:pitchId
export const actionApprovalCreator = async (req: Request, res: Response) => {
  const { token, pitchId } = req.params;
  const { action, comment } = req.body;

  if (action !== 'approve' && action !== 'reject' && action !== 'maybe') {
    return res.status(400).json({ message: "action must be 'approve', 'reject', or 'maybe'" });
  }

  const rawComment = typeof comment === 'string' ? comment.trim() : '';
  const commentToStore = rawComment.length > 0 ? rawComment.slice(0, APPROVAL_COMMENT_MAX_LEN) : null;

  try {
    const approvalRequest = await prisma.approvalRequest.findUnique({
      where: { token },
      include: { creators: true },
    });

    if (!approvalRequest) {
      return res.status(404).json({ message: 'Approval request not found' });
    }

    if (new Date() > approvalRequest.expiresAt) {
      return res.status(410).json({ message: 'This approval link has expired' });
    }

    const creatorEntry = approvalRequest.creators.find((c) => c.pitchId === pitchId);
    if (!creatorEntry) {
      return res.status(404).json({ message: 'Creator not found in this approval request' });
    }

    const isPending = creatorEntry.status === 'PENDING';
    const pitchBefore = await prisma.pitch.findUnique({
      where: { id: pitchId },
      select: { status: true, user: { select: { name: true } } },
    });

    if (isPending) {
      const approvalStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
      const pitchStatus = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'MAYBE';

      if (pitchBefore?.status && pitchBefore.status !== 'AWAITING_APPROVAL') {
        return res.status(400).json({
          message: `This creator has already been actioned (${pitchBefore.status}).`,
        });
      }

      await prisma.$transaction([
        prisma.approvalRequestCreator.update({
          where: { id: creatorEntry.id },
          data: {
            status: approvalStatus,
            ...(commentToStore !== null && { comment: commentToStore }),
          },
        }),
        prisma.pitch.update({
          where: { id: pitchId },
          data: {
            status: pitchStatus,
            ...(commentToStore !== null && { clientVisibleApprovalNote: commentToStore }),
          },
        }),
      ]);

      try {
        const creatorLabel = pitchBefore?.user?.name?.trim() || 'Creator';
        const approverNameFromRequest = approvalRequest.approverName?.trim() || 'Approver';
        const logMessage =
          action === 'approve'
            ? `${creatorLabel}'s profile has been approved by approver ${approverNameFromRequest}`
            : action === 'reject'
              ? `${creatorLabel}'s profile has been rejected by approver ${approverNameFromRequest}`
              : `Chose maybe for ${creatorLabel} by approver ${approverNameFromRequest}`;
        await prisma.campaignLog.create({
          data: {
            campaignId: approvalRequest.campaignId,
            message: logMessage,
          },
        });
      } catch (logErr) {
        console.error('Failed to write campaign log for approver action:', logErr);
      }
    } else {
      const matches =
        (creatorEntry.status === 'APPROVED' && action === 'approve') ||
        (creatorEntry.status === 'REJECTED' && (action === 'reject' || action === 'maybe'));
      if (!matches) {
        return res.status(400).json({
          message: 'Action does not match current approval state',
        });
      }
      const clearComment = req.body.clearComment === true;
      if (clearComment) {
        await prisma.$transaction([
          prisma.approvalRequestCreator.update({
            where: { id: creatorEntry.id },
            data: { comment: null },
          }),
          prisma.pitch.update({
            where: { id: pitchId },
            data: { clientVisibleApprovalNote: null },
          }),
        ]);
      } else if (commentToStore === null) {
        return res.status(400).json({
          message: 'Provide a comment to add or update the reason shown to the client',
        });
      } else {
        await prisma.$transaction([
          prisma.approvalRequestCreator.update({
            where: { id: creatorEntry.id },
            data: { comment: commentToStore },
          }),
          prisma.pitch.update({
            where: { id: pitchId },
            data: { clientVisibleApprovalNote: commentToStore },
          }),
        ]);
      }
    }

    const updatedCreators = await prisma.approvalRequestCreator.findMany({
      where: { approvalRequestId: approvalRequest.id },
    });
    const allActioned = updatedCreators.every((c) => c.status !== 'PENDING');

    const pitchAfter = await prisma.pitch.findUnique({
      where: { id: pitchId },
      select: { status: true },
    });
    if (io && approvalRequest.campaignId) {
      io.to(approvalRequest.campaignId).emit('v3:pitch:status-updated', {
        pitchId,
        campaignId: approvalRequest.campaignId,
        newStatus: pitchAfter?.status ?? null,
        action: isPending ? action : 'approval_note',
        updatedAt: new Date().toISOString(),
      });
    }

    const actionMessage =
      action === 'approve'
        ? 'Creator approved successfully'
        : action === 'reject'
          ? 'Creator rejected successfully'
          : 'Creator marked as maybe successfully';

    return res.status(200).json({
      message: isPending ? actionMessage : 'Comment saved successfully',
      allActioned,
      inviteToken: allActioned ? approvalRequest.inviteToken : null,
      approverNeedsSetup: approvalRequest.inviteToken !== null,
    });
  } catch (error) {
    console.error('Error actioning approval creator:', error);
    return res.status(500).json({ message: 'Error processing action' });
  }
};
