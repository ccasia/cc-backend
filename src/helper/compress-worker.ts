import { uploadQueue } from '@utils/queue';
import { Worker } from 'bullmq';
import connection from '@configs/redis';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';

import fs from 'fs-extra';

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
}

export interface Admin {
  adminId: string;
  campaignId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface FilePaths {
  video: { inputPath: string; outputPath: string; fileName: string }[];
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
        const percentage = Math.round(progress.percent as number);
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

const compressWorker = new Worker(
  'compress',
  async (job) => {
    const data = job.data as Root;
    const video = data.video;

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
          progress,
          userId: data.userid,
          submissionId: data.submissionId,
          inputPath: video.inputPath,
        });
      },
    );

    await uploadQueue.add('upload', { video, data: job.data }, { removeOnComplete: true });

    await fs.unlink(video.inputPath);
  },
  { connection, concurrency: 1 },
);

compressWorker.on('completed', (job) => {
  console.log('Job completed');
});

compressWorker.on('failed', () => {
  console.log('Compress failed');
});

process.on('SIGTERM', async () => {
  await compressWorker.close();
  process.exit(0);
});
