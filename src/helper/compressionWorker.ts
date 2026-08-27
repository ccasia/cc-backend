/* eslint-disable @typescript-eslint/no-empty-function */
import { Worker } from 'bullmq';
import connection from '../config/redis';
import { prisma } from '../prisma/prisma';
import os from 'os';

import { buildPublicUrl, deleteFile, downloadFromGCS, uploadToGCS } from '../lib/gcs';
import * as fs from 'fs-extra';
import { ProgressUpdate, runFfmpegCompression } from '../lib/ffmpeg';

const worker = new Worker(
  'compression-queue',
  async (job) => {
    const { uploadSessionId, rawObjectPath, submissionId, videoId } = job.data as {
      uploadSessionId: string;
      rawObjectPath: string;
      userId: string;
      campaignId: string;
      submissionId: string;
      videoId: string;
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

      localRawPath = await downloadFromGCS(rawObjectPath);
      localCompressedPath = await runFfmpegCompression(localRawPath, (progress: ProgressUpdate) => {
        job.updateProgress({
          submissionId,
          progress: progress.percent,
          uploadSessionId,
          etaSeconds: progress.etaSeconds,
        });
      });

      const compressedObjectPath = rawObjectPath.replace('raw/', 'final/');
      await uploadToGCS(localCompressedPath, compressedObjectPath);

      const video = await prisma.video.update({
        where: {
          id: videoId,
        },
        data: {
          url: buildPublicUrl(compressedObjectPath),
        },
      });

      await prisma.uploadSession.update({
        where: { id: uploadSessionId },
        data: {
          status: 'COMPLETED',
          video: {
            connect: {
              id: videoId,
            },
          },
        },
      });

      const newSubmission = await prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'PENDING_REVIEW' },
        select: {
          caption: true,
        },
      });

      return { uploadSessionId, progress: 100, submissionId, video: video, caption: newSubmission.caption };
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

worker.on('ready', () => {
  console.log('Compression Worker Ready');
});

worker.on('completed', async (job, returnvalue) => {
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
