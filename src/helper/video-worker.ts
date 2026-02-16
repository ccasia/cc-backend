import { Worker } from 'bullmq';
import connection from '@configs/redis';
import fs from 'fs-extra';
import { prisma } from 'src/prisma/prisma';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { uploadPitchVideo } from '@configs/cloudStorage.config';
import dayjs from 'dayjs';
import path from 'path';
import ora from 'ora';

import { clients, io } from '@configs/socket';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

export interface Root {
  userid: string;
  submissionId: string;
  campaignId: string;
  folder: string;
  caption: string;
  admins: Admin[];
  filePaths: FilePaths;
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
      .outputOptions(['-c:v libx264', '-crf 28', '-preset ultrafast', '-threads 4'])
      .save(outputPath)
      .on('progress', (progress) => {
        const percentage = Math.round(progress.percent as number);
        progressCallback('processing', percentage);
      })
      .on('end', async () => {
        if (io) {
          io.to(clients.get(userId)).emit('progress', {
            progress: 100,
            submissionId: submissionId,
            name: 'Compression Start',
            fileName: fileName,
            fileSize: fs.statSync(inputPath).size,
            fileType: path.extname(fileName),
          });
        }
        resolve();
      })
      .on('error', (err) => {
        console.error('Error processing video:', err);

        reject(err);
      });
  });
};

const videoProcessing = async (
  videos: FilePaths['video'],
  userId: string,
  campaignId: string,
  submissionId: string,
  caption: string,
  progressCallback: (type: string, fileName: string, progress: number, inputPath: string) => void,
) => {
  const requestChangeVideos = await prisma.video.findMany({
    where: {
      userId: userId,
      campaignId: campaignId,
      status: 'REVISION_REQUESTED',
    },
  });

  for (const video of videos) {
    const spinner = ora(`Processing video ${video.fileName}`).start();

    await processVideo(video.inputPath, video.outputPath, video.fileName, userId, submissionId, (type, progress) => {
      progressCallback(type, video.fileName, progress, video.inputPath);
    });
    spinner.succeed('Video Processed');

    const { size } = await fs.promises.stat(video.outputPath);

    spinner.start(`Uploading video ${video.fileName}`);
    const videoPublicURL = await uploadPitchVideo(
      video.outputPath,
      video.fileName,
      'Test',
      (data: number) => {
        progressCallback('uploading', video.fileName, Math.ceil(data), video.inputPath);
      },
      size,
    );
    spinner.succeed('Video Uploaded');

    if (!requestChangeVideos.length) {
      await prisma.video.create({
        data: {
          url: videoPublicURL,
          submissionId: submissionId,
          campaignId: campaignId,
          userId: userId,
        },
      });
    }

    await fs.unlink(video.inputPath);
  }

  // videos.forEach(async (video) => {
  //   const spinner = ora(`Processing video ${video.fileName}`).start();

  //   await processVideo(video.inputPath, video.outputPath, video.fileName, userId, submissionId, (type, progress) => {
  //     progressCallback(type, video.fileName, progress, video.inputPath);
  //   });
  //   spinner.succeed('Video Processed');

  //   const { size } = await fs.promises.stat(video.outputPath);

  //   spinner.start(`Uploading video ${video.fileName}`);
  //   const videoPublicURL = await uploadPitchVideo(
  //     video.outputPath,
  //     video.fileName,
  //     'Test',
  //     (data: number) => {
  //       progressCallback('uploading', video.fileName, Math.ceil(data), video.inputPath);
  //     },
  //     size,
  //   );
  //   spinner.succeed('Video Uploaded');

  // if (!requestChangeVideos.length) {
  //   await prisma.video.create({
  //     data: {
  //       url: videoPublicURL,
  //       submissionId: submissionId,
  //       campaignId: campaignId,
  //       userId: userId,
  //     },
  //   });
  // }

  //   await fs.unlink(video.inputPath);
  // });

  // await Promise.all(videoPromises);

  await prisma.submission.update({
    where: {
      id: submissionId,
    },
    data: {
      caption: caption,
      submissionDate: dayjs().format(),
    },
  });
};

const checkCurrentSubmission = async (submissionId: string) => {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      submissionType: true,
      campaign: true,
      feedback: true,
      video: true,
      rawFootages: true,
      photos: true,
      dependentOn: {
        select: {
          dependentSubmission: {
            select: {
              feedback: true,
              video: true,
              rawFootages: true,
              photos: true,
            },
          },
        },
      },
    },
  });

  if (!submission) throw new Error('Submission not found');

  const user = await prisma.shortListedCreator.findFirst({
    where: {
      userId: submission?.userId,
      campaignId: submission?.campaignId,
    },
    select: {
      ugcVideos: true,
    },
  });

  // For UGC campaigns (campaignCredits === null), we don't require the creator to be in shortlisted table
  // For campaigns with credits, the creator must be shortlisted
  if (!user && submission.campaign.campaignCredits !== null) {
    throw new Error('UGC Credits is not assigned to this creator');
  }

  const [videos, rawFootages, photos] = await Promise.all([
    prisma.video.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
    prisma.rawFootage.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
    prisma.photo.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
  ]);

  let allDeliverablesSent = false;

  if (submission?.submissionType.type === 'FIRST_DRAFT') {
    // For campaigns without campaignCredits (UGC campaigns), just check if at least one video is uploaded
    // For campaigns with campaignCredits, check if the exact number of ugcVideos is uploaded
    const hasVideo = submission.campaign.campaignCredits === null ? videos > 0 : videos === (user?.ugcVideos || 0);
    const hasRawFootage = submission.campaign.rawFootage ? rawFootages > 0 : true;
    const hasPhotos = submission.campaign.photos ? photos > 0 : true;

    allDeliverablesSent = hasVideo && hasRawFootage && hasPhotos;
  } else if (submission?.submissionType.type === 'FINAL_DRAFT') {
    const [videosWithRevision, rawFootagesWithRevision, photosWithRevision] = await Promise.all([
      prisma.video.count({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          status: 'REVISION_REQUESTED',
        },
      }),
      prisma.rawFootage.count({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          status: 'REVISION_REQUESTED',
        },
      }),
      prisma.photo.count({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          status: 'REVISION_REQUESTED',
        },
      }),
    ]);

    const hasVideos = videosWithRevision === 0;

    const hasRawFootage = submission.campaign.rawFootage ? rawFootagesWithRevision === 0 : true;

    const hasPhotos = submission.campaign.photos ? photosWithRevision === 0 : true;

    allDeliverablesSent = hasVideos && hasRawFootage && hasPhotos;
  }

  // Re-fetch current status (may have changed during processing)
  const currentSubmission = await prisma.submission.findUnique({
    where: { id: submission.id },
    select: { status: true },
  });

  // V4: Controller sets IN_PROGRESS for async uploads,
  // worker transitions to PENDING_REVIEW after processing
  if (submission.submissionVersion === 'v4') {
    if (currentSubmission?.status === 'IN_PROGRESS') {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'PENDING_REVIEW', submissionDate: dayjs().format() },
      });
      console.log(`[videoDraft] V4: IN_PROGRESS -> PENDING_REVIEW for submission ${submission.id}`);
    } else {
      // If status is already PENDING_REVIEW, APPROVED, SENT_TO_CLIENT, etc. — don't override
      console.log(`[videoDraft] V4: Preserving status ${currentSubmission?.status} for submission ${submission.id}`);
    }
  } else if (currentSubmission?.status === 'PENDING_REVIEW') {
    // Non-V4 already PENDING_REVIEW, skip
  } else {
    // Non-V4: original logic based on allDeliverablesSent
    if (allDeliverablesSent) {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'PENDING_REVIEW', submissionDate: dayjs().format() },
      });
    } else if (submission.submissionType.type === 'FIRST_DRAFT') {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'IN_PROGRESS' },
      });
    } else {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'CHANGES_REQUIRED' },
      });
    }
  }

  if (io) {
    const creatorSocketId = clients.get(submission.userId);
    if (creatorSocketId) {
      io.to(creatorSocketId).emit('updateSubmission');
    }
  }
};

const videoWorker = new Worker(
  'video-queue',
  async (job) => {
    const data = job.data as unknown as Root;

    const submission = await prisma.submission.findUnique({
      where: { id: data.submissionId },
      select: {
        campaignId: true,
        status: true,
        id: true,
        video: true,
        rawFootages: true,
        photos: true,
        submissionType: true,
        userId: true,
        campaign: {
          select: {
            rawFootage: true,
            photos: true,
            campaignCredits: true,
          },
        },
        feedback: {
          select: {
            videosToUpdate: true,
          },
        },
      },
    });

    if (!submission) throw new Error('Submission not found');

    await videoProcessing(
      data.filePaths.video,
      submission.userId,
      submission.campaignId,
      submission.id,
      data.caption,
      (type, fileName, progress, inputPath) => {
        job.updateProgress({
          type,
          fileName,
          progress,
          userId: submission.userId,
          submissionId: submission.id,
          inputPath,
        });
      },
    );

    await checkCurrentSubmission(submission.id);

    return job.data;
  },
  { connection, concurrency: 2 },
);

videoWorker.on('completed', async (job) => {
  console.log('✅ Job complete', job.id);
});

videoWorker.on('failed', async (err) => {
  const data = err?.data as unknown as Root;
  const videos = data.filePaths.video;

  // After 2nd attempt and still failed, remove the video path to clear some storage
  if (err?.attemptsMade === 2) {
    videos.forEach((video) => {
      return fs.unlink(video.inputPath);
    });
  }

  console.log('❌ Job failed', err?.data);
});

process.on('SIGTERM', async () => {
  await videoWorker.close();
  process.exit(0);
});
