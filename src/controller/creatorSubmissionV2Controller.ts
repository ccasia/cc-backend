import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { selectCurrentAgreementSubmission } from '@utils/submissionAgreement';
import { normalizeVideoDraftHistory } from '@helper/draftSubmissionStatus';

const prisma = new PrismaClient();

/**
 * V2 (legacy) creator submission API.
 *
 * V2 campaigns store deliverables differently from V4: video drafts use the
 * `FIRST_DRAFT` / `FINAL_DRAFT` submission types and there is no admin -> client
 * approval loop. The mobile app, however, is built around the V4 grouped shape
 * ({ agreement, videos[], photos[], rawFootage[] } with per-asset video[] rows).
 *
 * These endpoints query the legacy data and NORMALIZE it into the exact V4
 * envelope so the existing mobile components/hooks can be reused unchanged. The
 * only differences surfaced to the client are:
 *   - draft submission types are reported as `VIDEO` (with `deliverableLabel`)
 *   - `submissionVersion` is forced to `'v2'` so the app can branch UX
 *     (read-only feedback bottom sheet instead of the threaded feedback page).
 */

// Relations needed to build the V4-shaped response. Mirrors getV4Submissions.
const submissionInclude = {
  submissionType: true,
  campaign: {
    select: { id: true, name: true, campaignType: true },
  },
  user: {
    select: { id: true, name: true, email: true, photoURL: true },
  },
  video: {
    select: {
      id: true,
      url: true,
      status: true,
      feedback: true,
      reasons: true,
      feedbackAt: true,
      createdAt: true,
      adminId: true,
      previousDrafts: true,
      resubmittedFromId: true,
      admin: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  photos: {
    select: {
      id: true,
      url: true,
      status: true,
      feedback: true,
      reasons: true,
      feedbackAt: true,
      createdAt: true,
    },
  },
  rawFootages: {
    select: {
      id: true,
      url: true,
      status: true,
      feedback: true,
      reasons: true,
      feedbackAt: true,
      createdAt: true,
    },
  },
  feedback: {
    include: {
      admin: { select: { id: true, name: true, role: true, photoURL: true } },
      submissionComment: {
        include: {
          replies: {
            include: {
              user: { select: { id: true, name: true, role: true, photoURL: true } },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

const DRAFT_TYPES = ['FIRST_DRAFT', 'FINAL_DRAFT'] as const;
const POSTING_TYPE = 'POSTING';

const draftLabel = (type: string): string =>
  type === 'FIRST_DRAFT'
    ? 'First Draft'
    : type === 'FINAL_DRAFT'
      ? 'Final Draft'
      : type === POSTING_TYPE
        ? 'Posting Link'
        : 'Video';

const draftOrder = (type: string): number => (type === 'FIRST_DRAFT' ? 1 : type === 'FINAL_DRAFT' ? 2 : 0);

/**
 * Flatten a Feedback row to the shape the mobile expects: the comment text and
 * timestamp come from the linked SubmissionComment when present, and replies are
 * mapped to { id, content, createdAt, user }.
 */
const feedbackText = (feedback: any): string | null =>
  feedback.submissionComment?.text || feedback.content || feedback.rawFootageContent || feedback.photoContent || null;

const feedbackVideoId = (feedback: any): string | null =>
  feedback.videoId || feedback.submissionComment?.videoId || feedback.videosToUpdate?.[0] || null;

const shouldShowFeedback = (feedback: any, isDraft: boolean): boolean =>
  feedback.sentToCreator || (isDraft && feedback.type === 'REQUEST');

const mapFeedback = (feedback: any) => ({
  ...feedback,
  content: feedbackText(feedback),
  videoId: feedbackVideoId(feedback),
  timestamp: feedback.submissionComment?.timestamp ?? null,
  resolved: !!feedback.submissionComment?.resolvedByUserId,
  replies: (feedback.submissionComment?.replies ?? []).map((r: any) => ({
    id: r.id,
    content: r.text,
    createdAt: r.createdAt,
    user: r.user,
  })),
});

/**
 * Normalize a single legacy submission into the V4 envelope. Draft submissions
 * are reported with `submissionType.type = 'VIDEO'` so they render through the
 * app's existing video flow; the real label/order are kept separately.
 */
const normalizeSubmission = (submission: any) => {
  const realType: string = submission.submissionType?.type;
  const isDraft = (DRAFT_TYPES as readonly string[]).includes(realType);
  const video = isDraft ? normalizeVideoDraftHistory(submission.video ?? []) : submission.video;

  // V2 draft change-requests predate sentToCreator in some rows. Keep the V4
  // visibility rule, but also surface historical REQUEST feedback on drafts.
  const feedback = (submission.feedback ?? []).filter((f: any) => shouldShowFeedback(f, isDraft)).map(mapFeedback);

  return {
    ...submission,
    submissionVersion: 'v2',
    video,
    feedback,
    ...(isDraft && {
      submissionType: { ...submission.submissionType, type: 'VIDEO' },
      deliverableType: realType,
      deliverableLabel: draftLabel(realType),
      contentOrder: submission.contentOrder ?? draftOrder(realType),
    }),
  };
};

const COMPLETED_STATUSES = ['APPROVED', 'CLIENT_APPROVED', 'POSTED'];
const POSTING_ACTIVE_STATUSES = [
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'SENT_TO_ADMIN',
  'SENT_TO_CLIENT',
  'CLIENT_APPROVED',
  'CLIENT_FEEDBACK',
  'CHANGES_REQUIRED',
  'REJECTED',
  'APPROVED',
  'POSTED',
];

const isApprovedDraft = (submission: any): boolean =>
  (DRAFT_TYPES as readonly string[]).includes(submission.deliverableType) &&
  COMPLETED_STATUSES.includes(submission.status);

const latestApprovedDraft = (drafts: any[]): any | undefined =>
  drafts.filter(isApprovedDraft).sort((a: any, b: any) => {
    const aSubmitted = a.submissionDate ? new Date(a.submissionDate).getTime() : 0;
    const bSubmitted = b.submissionDate ? new Date(b.submissionDate).getTime() : 0;
    if (aSubmitted !== bSubmitted) return bSubmitted - aSubmitted;
    return (b.contentOrder ?? 0) - (a.contentOrder ?? 0);
  })[0];

const normalizePostingSubmission = (posting: any, approvedDraft: any) => ({
  ...normalizeSubmission(posting),
  submissionVersion: 'v2',
  submissionType: { ...posting.submissionType, type: POSTING_TYPE },
  deliverableType: POSTING_TYPE,
  deliverableLabel: 'Posting Link',
  contentOrder: posting.contentOrder ?? 3,
  caption: approvedDraft?.caption ?? posting.caption,
  video: approvedDraft?.video ?? [],
  photos: approvedDraft?.photos ?? [],
  rawFootages: approvedDraft?.rawFootages ?? [],
});

const shouldExposePosting = (posting: any | undefined, approvedDraft: any | undefined): boolean =>
  !!posting && !!approvedDraft && POSTING_ACTIVE_STATUSES.includes(posting.status);

/**
 * Get the creator's own V2 submissions for a campaign, normalized to the V4 shape.
 * GET /api/creator/submissions/v2?campaignId=xxx
 */
export const getMyV2Submissions = async (req: Request, res: Response) => {
  const { campaignId } = req.query;
  const creatorId = req.userId;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }
    if (!campaignId) {
      return res.status(400).json({ message: 'campaignId is required' });
    }

    // Verify the creator is shortlisted on this campaign (same guard as V4).
    const creatorAccess = await prisma.shortListedCreator.findFirst({
      where: { campaignId: campaignId as string, userId: creatorId },
    });
    if (!creatorAccess) {
      return res.status(403).json({
        message: 'You do not have access to this campaign or are not approved',
      });
    }

    // Surface the agreement + video drafts, plus the legacy POSTING row once an
    // approved draft has activated the posting stage.
    const submissions = await prisma.submission.findMany({
      where: {
        campaignId: campaignId as string,
        userId: creatorId,
        submissionType: {
          type: { in: ['AGREEMENT_FORM', ...DRAFT_TYPES, POSTING_TYPE] },
        },
      },
      include: submissionInclude as any,
    });

    const normalized = submissions.map(normalizeSubmission);

    const agreement = selectCurrentAgreementSubmission(
      normalized.filter((s: any) => s.deliverableType === undefined && s.submissionType?.type !== POSTING_TYPE),
    );

    // The Final Draft only becomes relevant once the First Draft needs changes
    // (submission-level CHANGES_REQUIRED, or any video flagged REVISION_REQUESTED).
    // Until then, only the First Draft is shown to the creator.
    const drafts = normalized.filter((s: any) => s.deliverableType !== undefined);
    const firstDraft = drafts.find((s: any) => s.deliverableType === 'FIRST_DRAFT');
    const firstDraftNeedsChanges =
      !!firstDraft &&
      (firstDraft.status === 'CHANGES_REQUIRED' ||
        (firstDraft.video ?? []).some((v: any) => v.isCurrentDraft !== false && v.status === 'REVISION_REQUESTED'));

    const videos = drafts
      .filter(
        (s: any) =>
          s.deliverableType === 'FIRST_DRAFT' || (s.deliverableType === 'FINAL_DRAFT' && firstDraftNeedsChanges),
      )
      .sort((a: any, b: any) => (a.contentOrder ?? 0) - (b.contentOrder ?? 0));
    const approvedDraft = latestApprovedDraft(drafts);
    const postingSource = submissions.find((s: any) => s.submissionType?.type === POSTING_TYPE);
    const posting = shouldExposePosting(postingSource, approvedDraft)
      ? normalizePostingSubmission(postingSource, approvedDraft)
      : undefined;

    const grouped = {
      agreement,
      videos,
      photos: [] as any[],
      rawFootage: [] as any[],
      ...(posting && { posting }),
    };

    // Progress reflects only the submissions actually shown to the creator.
    const visible = [...(agreement ? [agreement] : []), ...videos, ...(posting ? [posting] : [])];
    const total = visible.length;
    const completed = visible.filter((s: any) => COMPLETED_STATUSES.includes(s.status)).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return res.status(200).json({
      submissions: visible,
      grouped,
      progress,
      total,
      completed,
    });
  } catch (error) {
    console.error('Error getting creator v2 submissions:', error);
    return res.status(500).json({
      message: 'Failed to get your submissions',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get a single V2 submission detail for the creator, normalized to the V4 shape.
 * GET /api/creator/submissions/v2/:submissionId
 */
export const getMyV2SubmissionDetails = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const creatorId = req.userId;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: submissionInclude as any,
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    if ((submission as any).userId !== creatorId) {
      return res.status(403).json({ message: 'You do not have access to this submission' });
    }

    if ((submission as any).submissionType?.type === POSTING_TYPE) {
      const approvedDrafts = await prisma.submission.findMany({
        where: {
          campaignId: (submission as any).campaignId,
          userId: creatorId,
          status: { in: COMPLETED_STATUSES as any },
          submissionType: { type: { in: DRAFT_TYPES as any } },
        },
        include: submissionInclude as any,
      });
      const approvedDraft = latestApprovedDraft(approvedDrafts.map(normalizeSubmission));
      if (!shouldExposePosting(submission, approvedDraft)) {
        return res.status(404).json({ message: 'Submission not found' });
      }
      return res.status(200).json({ submission: normalizePostingSubmission(submission, approvedDraft) });
    }

    return res.status(200).json({ submission: normalizeSubmission(submission) });
  } catch (error) {
    console.error('Error getting creator v2 submission detail:', error);
    return res.status(500).json({
      message: 'Failed to get submission detail',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Submit or resubmit a legacy V2 posting link.
 * PUT /api/creator/submissions/v2/posting-link
 */
export const updateMyV2PostingLink = async (req: Request, res: Response) => {
  const { submissionId, postingLink } = req.body as { submissionId?: string; postingLink?: string };
  const creatorId = req.userId;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }
    if (!submissionId || !postingLink) {
      return res.status(400).json({ message: 'submissionId and postingLink are required' });
    }

    const trimmedLink = postingLink.trim();
    try {
      new URL(trimmedLink);
    } catch {
      return res.status(400).json({ message: 'Invalid posting link URL' });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { submissionType: true },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    if ((submission as any).userId !== creatorId) {
      return res.status(403).json({ message: 'You can only update posting links for your own submissions' });
    }
    if ((submission as any).submissionType?.type !== POSTING_TYPE) {
      return res.status(400).json({ message: 'Posting link can only be submitted for a POSTING submission' });
    }
    if (!POSTING_ACTIVE_STATUSES.includes((submission as any).status)) {
      return res.status(400).json({ message: 'Posting link is not active for this submission' });
    }

    const approvedDrafts = await prisma.submission.findMany({
      where: {
        campaignId: (submission as any).campaignId,
        userId: creatorId,
        status: { in: COMPLETED_STATUSES as any },
        submissionType: { type: { in: DRAFT_TYPES as any } },
      },
      include: submissionInclude as any,
    });
    const approvedDraft = latestApprovedDraft(approvedDrafts.map(normalizeSubmission));
    if (!approvedDraft) {
      return res.status(400).json({ message: 'A draft must be approved before submitting a posting link' });
    }

    const updated = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        content: trimmedLink,
        videos: [trimmedLink],
        submissionDate: new Date(),
        status: 'PENDING_REVIEW',
      },
      include: submissionInclude as any,
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        submissionId,
        campaignId: (submission as any).campaignId,
        postingLink: trimmedLink,
        newStatus: 'PENDING_REVIEW',
        updatedAt: new Date().toISOString(),
        creatorId,
      };
      io.to((submission as any).campaignId).emit('v2:posting:updated', payload);
      io.to((submission as any).campaignId).emit('v2:campaign:updated', {
        campaignId: (submission as any).campaignId,
        updatedAt: payload.updatedAt,
      });
    }

    return res.status(200).json({
      message: 'Posting link submitted successfully',
      submission: normalizePostingSubmission(updated, approvedDraft),
      postingLink: trimmedLink,
    });
  } catch (error) {
    console.error('Error updating creator v2 posting link:', error);
    return res.status(500).json({
      message: 'Failed to submit posting link',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
