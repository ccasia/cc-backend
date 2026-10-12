import { createVideoThumbnail } from '@helper/videoThumbnail';
import { prisma } from '@/src/prisma/prisma';

// Card previews render at 135x240, so 2x covers high-density screens
const THUMBNAIL_SIZE = { width: 270, height: 480 };
const MAX_CONCURRENT = 2;

type MediaKind = 'video' | 'rawFootage';
interface MediaJob {
  kind: MediaKind;
  id: string;
  url: string;
}
interface MediaRecord {
  id: string;
  url: string | null;
  thumbnailUrl?: string | null;
}
interface SubmissionWithMedia {
  video?: MediaRecord[];
  rawFootages?: MediaRecord[];
}

// In-memory on purpose: a restart only means some thumbnails get queued again on the next view
const queued = new Set<string>();
const failed = new Set<string>();
const pending: MediaJob[] = [];
let running = 0;

const saveThumbnail = async ({ kind, id, url }: MediaJob) => {
  const thumbnailUrl = await createVideoThumbnail(url, {
    name: id,
    folder: 'submissionThumbnails',
    ...THUMBNAIL_SIZE,
  });

  if (kind === 'video') await prisma.video.update({ where: { id }, data: { thumbnailUrl } });
  else await prisma.rawFootage.update({ where: { id }, data: { thumbnailUrl } });
};

const runJob = async (job: MediaJob) => {
  try {
    await saveThumbnail(job);
  } catch (error) {
    failed.add(job.id);
    console.error('Failed to generate submission thumbnail', { kind: job.kind, id: job.id, error });
  } finally {
    running -= 1;
    queued.delete(job.id);
    runNext();
  }
};

function runNext() {
  if (running >= MAX_CONCURRENT) return;
  const job = pending.shift();
  if (!job) return;

  running += 1;
  void runJob(job);
}

const enqueue = (kind: MediaKind, media: MediaRecord) => {
  if (!media.url || media.thumbnailUrl || queued.has(media.id) || failed.has(media.id)) return;
  queued.add(media.id);
  pending.push({ kind, id: media.id, url: media.url });
  runNext();
};

// Fire-and-forget: thumbnails show up on the next fetch. Covers every upload path and old rows.
export const queueMissingThumbnails = (submissions: SubmissionWithMedia[]) => {
  submissions.forEach((submission) => {
    submission.video?.forEach((media) => enqueue('video', media));
    submission.rawFootages?.forEach((media) => enqueue('rawFootage', media));
  });
};
