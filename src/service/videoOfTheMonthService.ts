import { PrismaClient, Prisma } from '@prisma/client';
import { createVideoOfTheMonthThumbnail } from '@helper/videoOfTheMonthThumbnail';

const prisma = new PrismaClient();

// Shape returned to the mobile app for each featured video.
export interface FeaturedVideo {
  id: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  brand: string; // campaign name
  creator: string; // creator (user) name
}

const featuredInclude = {
  submission: {
    select: {
      id: true,
      video: {
        where: { url: { not: null }, status: { not: 'REJECTED' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, url: true },
      },
      user: { select: { id: true, name: true } },
      campaign: {
        select: {
          id: true,
          name: true,
          brand: { select: { name: true } },
          company: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.VideoOfTheMonthInclude;

type FeaturedRecord = Prisma.VideoOfTheMonthGetPayload<{ include: typeof featuredInclude }>;

const resolveVideoUrl = (record: FeaturedRecord): string | null => {
  const videos = record.submission.video ?? [];
  if (videos.length === 0) return null;
  const index = record.videoIndex >= 0 && record.videoIndex < videos.length ? record.videoIndex : 0;
  return videos[index]?.url ?? videos[0]?.url ?? null;
};

const resolveBrand = (record: FeaturedRecord): string => {
  const campaign = record.submission.campaign;
  return campaign?.company?.name ?? campaign?.brand?.name ?? campaign?.name ?? 'Cult Creative';
};

const resolveCreator = (record: FeaturedRecord): string => {
  const name = record.submission.user?.name?.trim();
  if (!name) return 'Cult Creator';
  return name.split(/\s+/).slice(0, 2).join(' ');
};

export const getFeaturedVideos = async (): Promise<FeaturedVideo[]> => {
  const records = await prisma.videoOfTheMonth.findMany({
    where: { featured: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: featuredInclude,
  });

  return records.reduce<FeaturedVideo[]>((acc, record) => {
    const videoUrl = resolveVideoUrl(record);
    if (!videoUrl) return acc; // submission lost its video — skip rather than render a broken card
    acc.push({
      id: record.id,
      videoUrl,
      thumbnailUrl: record.thumbnailUrl,
      brand: resolveBrand(record),
      creator: resolveCreator(record),
    });
    return acc;
  }, []);
};

// Admin list for the curation table — full records with submission detail.
export const listCuratedVideos = async () => {
  return prisma.videoOfTheMonth.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: featuredInclude,
  });
};

// Search submissions CS can feature: any submission with at least one uploaded
// (non-rejected) video file. `search` matches campaign or creator name.
export const searchFeaturableSubmissions = async (search?: string) => {
  const trimmed = search?.trim();
  const where: Prisma.SubmissionWhereInput = {
    video: { some: { url: { not: null }, status: { not: 'REJECTED' } } },
    ...(trimmed
      ? {
          OR: [
            { campaign: { name: { contains: trimmed, mode: 'insensitive' } } },
            { user: { name: { contains: trimmed, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  return prisma.submission.findMany({
    where,
    take: 50,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      status: true,
      video: {
        // Latest first — matches what gets featured (videoIndex 0).
        where: { url: { not: null }, status: { not: 'REJECTED' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, url: true },
      },
      user: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      videoOfTheMonth: { select: { id: true } }, // so the UI can show what's already featured
    },
  });
};

export interface CreateFeaturedInput {
  submissionId: string;
  videoIndex?: number;
  order?: number;
  createdById: string;
}

// Feature a submission. Guards: submission must exist and have a video at the
// requested index. The unique submissionId constraint prevents duplicates.
export const createFeaturedVideo = async (input: CreateFeaturedInput) => {
  const submission = await prisma.submission.findUnique({
    where: { id: input.submissionId },
    select: {
      id: true,
      video: {
        where: { url: { not: null }, status: { not: 'REJECTED' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, url: true },
      },
    },
  });

  if (!submission) {
    throw new Error('SUBMISSION_NOT_FOUND');
  }

  const videos = submission.video ?? [];
  if (videos.length === 0) {
    throw new Error('SUBMISSION_HAS_NO_VIDEO');
  }

  const videoIndex = input.videoIndex ?? 0;
  if (videoIndex < 0 || videoIndex >= videos.length) {
    throw new Error('VIDEO_INDEX_OUT_OF_RANGE');
  }

  const created = await prisma.videoOfTheMonth.create({
    data: {
      submissionId: input.submissionId,
      videoIndex,
      order: input.order ?? 0,
      createdById: input.createdById,
    },
    include: featuredInclude,
  });

  try {
    return await generateFeaturedVideoThumbnail(created.id);
  } catch (error) {
    console.error('Failed to generate featured video thumbnail', { id: created.id, error });
    return created;
  }
};

export interface UpdateFeaturedInput {
  order?: number;
  featured?: boolean;
  videoIndex?: number;
}

export const updateFeaturedVideo = async (id: string, input: UpdateFeaturedInput) => {
  const updated = await prisma.videoOfTheMonth.update({
    where: { id },
    data: {
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.featured !== undefined ? { featured: input.featured } : {}),
      ...(input.videoIndex !== undefined ? { videoIndex: input.videoIndex } : {}),
    },
    include: featuredInclude,
  });

  if (input.videoIndex === undefined && updated.thumbnailUrl) return updated;

  try {
    return await generateFeaturedVideoThumbnail(id);
  } catch (error) {
    console.error('Failed to generate featured video thumbnail', { id, error });
    return updated;
  }
};

export const generateFeaturedVideoThumbnail = async (id: string) => {
  const record = await prisma.videoOfTheMonth.findUnique({
    where: { id },
    include: featuredInclude,
  });

  if (!record) throw new Error('FEATURED_VIDEO_NOT_FOUND');

  const videoUrl = resolveVideoUrl(record);
  if (!videoUrl) throw new Error('SUBMISSION_HAS_NO_VIDEO');

  const thumbnailUrl = await createVideoOfTheMonthThumbnail(videoUrl, record.id);

  return prisma.videoOfTheMonth.update({
    where: { id },
    data: { thumbnailUrl },
    include: featuredInclude,
  });
};

export const deleteFeaturedVideo = async (id: string) => {
  return prisma.videoOfTheMonth.delete({ where: { id } });
};
