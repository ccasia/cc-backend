import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COMMENT_USER_SELECT = {
  id: true,
  name: true,
  role: true,
  photoURL: true,
  client: {
    select: { company: { select: { logo: true } } },
  },
};

const COMMENT_BASE_INCLUDE = {
  user: { select: COMMENT_USER_SELECT },
  forwardedBy: { select: COMMENT_USER_SELECT },
  resolvedBy: { select: { id: true, name: true } },
  agreedBy: {
    select: {
      userId: true,
      user: { select: { id: true, name: true } },
    },
  },
};

// Fetch comments for a submission, optionally filtered by videoId and user role
export const fetchCommentsForVideo = async (
  submissionId: string,
  videoId: string | undefined,
  roleFilter: any,
  excludeClientDrafts = false,
  filterInvisibleToCreator = false,
) => {
  const where: any = {
    submissionId,
    parentId: null,
  };

  if (videoId) {
    where.videoId = videoId;
  }

  // Hide unpublished client draft comments from admins and creators
  if (excludeClientDrafts) {
    where.isClientDraft = false;
  }

  // For role-filtered queries, also include forwarded comments (client comments
  // that have been forwarded by an admin should be visible to creators)
  if (roleFilter && Object.keys(roleFilter).length > 0) {
    where.OR = [{ user: { role: roleFilter } }, { forwardedByUserId: { not: null } }];
  }

  let replyWhere: any =
    roleFilter && Object.keys(roleFilter).length > 0
      ? {
          OR: [{ user: { role: roleFilter } }, { forwardedByUserId: { not: null } }],
        }
      : undefined;

  // Also exclude client drafts from replies
  if (excludeClientDrafts) {
    replyWhere = replyWhere ? { ...replyWhere, isClientDraft: false } : { isClientDraft: false };
  }

  // Hide comments marked as not visible to creator
  if (filterInvisibleToCreator) {
    where.isVisibleToCreator = true;
    replyWhere = replyWhere
      ? { ...replyWhere, isVisibleToCreator: true }
      : { isVisibleToCreator: true };
  }

  const comments = await prisma.submissionComment.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      ...COMMENT_BASE_INCLUDE,
      replies: {
        where: replyWhere,
        orderBy: { createdAt: 'asc' as const },
        include: COMMENT_BASE_INCLUDE,
      },
    },
  });

  // Flatten orphaned replies: visible replies whose parent is hidden should
  // be promoted to top-level so creators can still see them
  if (filterInvisibleToCreator) {
    const orphanWhere: any = {
      submissionId,
      parentId: { not: null },
      isVisibleToCreator: true,
      parent: { isVisibleToCreator: false },
    };
    if (videoId) orphanWhere.videoId = videoId;
    if (excludeClientDrafts) orphanWhere.isClientDraft = false;
    if (roleFilter && Object.keys(roleFilter).length > 0) {
      orphanWhere.OR = [{ user: { role: roleFilter } }, { forwardedByUserId: { not: null } }];
    }

    const orphanedReplies = await prisma.submissionComment.findMany({
      where: orphanWhere,
      orderBy: { createdAt: 'asc' },
      include: {
        ...COMMENT_BASE_INCLUDE,
        parent: { select: { timestamp: true, editedTimestamp: true } },
      },
    });

    // Group orphaned replies by their shared hidden parent.
    // First reply (by createdAt) becomes the virtual top-level comment,
    // subsequent siblings become its replies.
    // Replies without a timestamp inherit from their hidden parent.
    const inheritTimestamp = (reply: any) => {
      if (!reply.timestamp && reply.parent) {
        const parentTs = reply.parent.editedTimestamp || reply.parent.timestamp;
        if (parentTs) reply.timestamp = parentTs;
      }
      delete reply.parent;
      return reply;
    };

    const groupedByParent = new Map<string, any[]>();
    for (const reply of orphanedReplies) {
      const pid = reply.parentId as string;
      if (!groupedByParent.has(pid)) {
        groupedByParent.set(pid, []);
      }
      groupedByParent.get(pid)!.push(inheritTimestamp(reply));
    }

    for (const siblings of groupedByParent.values()) {
      const [first, ...rest] = siblings; // already sorted by createdAt asc
      (comments as any[]).push({ ...first, replies: rest });
    }

    // Re-sort by createdAt after merging
    (comments as any[]).sort(
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  return comments;
};

// Create a new comment or reply
export const createCommentRecord = async (
  submissionId: string,
  userId: string,
  text: string,
  timestamp?: string,
  videoId?: string,
  parentId?: string,
) => {
  const comment = await prisma.submissionComment.create({
    data: {
      text,
      timestamp: timestamp || null,
      submissionId,
      userId,
      videoId: videoId || null,
      parentId: parentId || null,
    },
    include: {
      ...COMMENT_BASE_INCLUDE,
      submission: { select: { campaignId: true } },
    },
  });

  return comment;
};

// Edit a comment's text and optionally set forwardedByUserId
export const editCommentRecord = async (commentId: string, newText: string, forwardedByUserId?: string, timestamp?: string) => {
  const data: any = {};

  if (forwardedByUserId) {
    // Editing a client's comment — preserve original text, store admin's version in editedText
    data.editedText = newText;
    if (timestamp !== undefined) {
      data.editedTimestamp = timestamp;
    }
    data.forwardedByUserId = forwardedByUserId;
    data.isVisibleToCreator = true;
  } else {
    // Admin editing their own comment — overwrite text directly
    data.text = newText;
    if (timestamp !== undefined) {
      data.timestamp = timestamp;
    }
  }

  const comment = await prisma.submissionComment.update({
    where: { id: commentId },
    data,
    include: {
      ...COMMENT_BASE_INCLUDE,
      submission: { select: { campaignId: true } },
    },
  });

  return comment;
};
