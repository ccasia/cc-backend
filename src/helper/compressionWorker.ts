/* eslint-disable @typescript-eslint/no-empty-function */
import { Worker } from 'bullmq';
import connection from '../config/redis';
import { prisma } from '../prisma/prisma';

import { buildPublicUrl, deleteFile, downloadFromGCS, uploadToGCS } from '../lib/gcs';
import * as fs from 'fs-extra';
import { runFfmpegCompression } from '../lib/ffmpeg';

const worker = new Worker(
  'compression-queue',
  async (job) => {
    const { uploadSessionId, rawObjectPath, userId, campaignId, submissionId } = job.data as {
      uploadSessionId: string;
      rawObjectPath: string;
      userId: string;
      campaignId: string;
      submissionId: string;
    };

    await prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: { status: 'COMPRESSING' },
    });

    let localRawPath: string | undefined;
    let localCompressedPath: string | undefined;

    try {
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { id: true },
      });

      if (!submission) throw new Error('Submission not found');

      // find the video (if any) this new submission is resubmitting against
      const requestChangeVideos = await prisma.video.findMany({
        where: {
          submissionId: submission.id,
          status: 'REVISION_REQUESTED',
          resubmissions: { none: {} },
        },
        orderBy: { createdAt: 'asc' },
      });

      const videoToReplace = requestChangeVideos[0]; // oldest un-resubmitted revision request

      localRawPath = await downloadFromGCS(rawObjectPath);
      localCompressedPath = await runFfmpegCompression(localRawPath, (progress: number | undefined) => {
        job.updateProgress({ submissionId, progress, uploadSessionId });
      });

      const compressedObjectPath = rawObjectPath.replace('raw/', 'final/');
      await uploadToGCS(localCompressedPath, compressedObjectPath);

      // single write — status and resubmittedFromId computed upfront, no follow-up update
      const video = await prisma.video.create({
        data: {
          url: buildPublicUrl(compressedObjectPath),
          status: 'PENDING',
          userId,
          campaignId,
          submissionId,
          ...(videoToReplace && { resubmittedFromId: videoToReplace.id }),
        },
      });

      await prisma.uploadSession.update({
        where: { id: uploadSessionId },
        data: { status: 'COMPLETED', videoId: video.id },
      });

      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'PENDING_REVIEW' },
      });

      return uploadSessionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await prisma.uploadSession.update({
        where: { id: uploadSessionId },
        data: { status: 'COMPRESSION_FAILED', errorMessage: message, failedAt: new Date() },
      });

      throw err;
    } finally {
      if (localRawPath) await fs.unlink(localRawPath).catch(() => {});
      if (localCompressedPath) await fs.unlink(localCompressedPath).catch(() => {});
    }
  },
  { connection, concurrency: 2 }, // tune based on your Compute Engine instance's CPU
);

worker.on('completed', async (job) => {
  await deleteFile(job.data.rawObjectPath);
  console.log(`Compression job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Compression job ${job?.id} failed:`, err);
});

worker.on('error', (error) => {
  console.error('Worker-level error:', error);
});

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
