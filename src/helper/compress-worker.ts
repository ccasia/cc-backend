import { uploadQueue } from '@utils/queue';
import { Worker } from 'bullmq';
import connection from '@configs/redis';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';

import fs from 'fs-extra';
import { prisma } from 'src/prisma/prisma';
import { Video } from '@prisma/client';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

export interface Root {
  userid: string;
  submissionId: string;
  campaignId: string;
  folder: string;
  caption: string;
  admins: Admin[];
  video: FilePaths['video'][0];
  videoData: Video;
}

export interface Admin {
  adminId: string;
  campaignId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface FilePaths {
  video: { inputPath: string; outputPath: string; fileName: string; originalFileName: string }[];
}

const processVideo = async (
  inputPath: string,
  outputPath: string,
  fileName: string,
  userId: string,
  submissionId: string,
  progressCallback: (type: string, progress: number) => void,
) => {
  return new Promise<void>((resolve, reject) => {
    const command = Ffmpeg(inputPath)
      .outputOptions(['-c:v libx264', '-crf 28', '-preset ultrafast'])
      .save(outputPath)
      .on('progress', (progress) => {
        const percentage = Math.min(100, Math.max(0, Math.round(progress.percent ?? 0)));
        progressCallback('processing', percentage);
      })
      .on('end', async () => {
        resolve();
      })
      .on('error', (err) => {
        console.error('Error processing video:', err);

        reject(err);
      });
  });
};

console.log('COMPRESSION WORKER IS RUNING...');

const compressWorker = new Worker(
  'compress',
  async (job) => {
    const data = job.data as Root;
    const video = data.video;
    const videoData = data.videoData;
    console.log('RECEIVING ', data);

    await prisma.video.update({
      where: { id: videoData.id },
      data: {
        uploadStatus: 'COMPRESSING',
      },
    });

    await processVideo(
      video.inputPath,
      video.outputPath,
      video.fileName,
      data.userid,
      data.submissionId,
      (type, progress) => {
        job.updateProgress({
          type,
          fileName: video.fileName,
          originalFileName: video.originalFileName,
          progress,
          userId: data.userid,
          submissionId: data.submissionId,
          inputPath: video.inputPath,
        });
      },
    );

    await uploadQueue.add(
      'upload',
      { video, data: job.data },
      {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: false,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    );

    await fs.unlink(video.inputPath);
  },
  { connection, concurrency: 1 },
);

compressWorker.on('completed', (job) => {
  console.log('Job completed');
});

compressWorker.on('failed', (_, err) => {
  console.log('Compress failed', err);
});

process.on('SIGTERM', async () => {
  await compressWorker.close();
  await prisma.$disconnect();
  process.exit(0);
});
