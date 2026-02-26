import { delay, Worker } from 'bullmq';
import connection from '@configs/redis';
import { uploadPitchVideo } from '@configs/cloudStorage.config';
import fs from 'fs-extra';
import { prisma } from 'src/prisma/prisma';
import dayjs from 'dayjs';
import { updateSubmissionStatus } from './updateSubmissionStatus';

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
};

console.log('UPLOAD WORKER IS RUNNING....');

const uploadWorker = new Worker(
  'upload',
  async (job) => {
    const data = job.data.data;
    const video = data.video;
    const videoData = data.videoData;

    await prisma.video.update({
      where: { id: videoData.id },
      data: {
        uploadStatus: 'UPLOADING',
      },
    });

    const { size } = await fs.promises.stat(video.outputPath);

    const videoPublicURL = await uploadPitchVideo(
      video.outputPath,
      video.fileName,
      'Test',
      (progress) => {
        job.updateProgress({
          type: 'uploading',
          fileName: video.fileName,
          progress,
          userId: data.userid,
          outputPath: video.outputPath,
          submissionId: data.submissionId,
          originalFileName: video.originalFileName,
        });
      },
      size,
    );

    await prisma.video.update({
      where: {
        id: videoData.id,
      },
      data: {
        url: videoPublicURL,
        status: 'PENDING',
        uploadStatus: 'COMPLETED',
      },
    });

    await updateSubmissionStatus(videoData.submissionId!);

    return { userId: data.userid };

    // const submission = await prisma.submission.findUnique({
    //   where: {
    //     id: data.submissionId,
    //   },
    //   select: {
    //     id: true,
    //     submissionType: true,
    //     video: true,
    //   },
    // });

    // const creator = await prisma.shortListedCreator.findFirst({
    //   where: {
    //     userId: data.userid,
    //     campaignId: data.campaignId,
    //   },
    //   select: {
    //     ugcVideos: true,
    //   },
    // });

    // const videos_count = submission?.video.length;
    // const total_videos_count = creator?.ugcVideos;

    // if (submission?.submissionType.type === 'FINAL_DRAFT') {
    //   const revisionRequestedVideo = await prisma.video.findFirst({
    //     where: {
    //       userId: data.userid,
    //       campaignId: data.campaignId,
    //       status: 'REVISION_REQUESTED',
    //     },
    //   });

    //   await prisma.video.update({
    //     where: {
    //       id: revisionRequestedVideo?.id,
    //     },
    //     data: {
    //       submissionId: submission.id,
    //       url: videoPublicURL,
    //       status: 'PENDING',
    //     },
    //   });
    // } else {
    //   await prisma.video.create({
    //     data: {
    //       submissionId: data.submissionId,
    //       url: videoPublicURL,
    //       status: 'PENDING',
    //       userId: data.userid,
    //       campaignId: data.campaignId,
    //     },
    //   });
    // }

    // if (videos_count === total_videos_count) {
    //   await prisma.submission.update({
    //     where: {
    //       id: submission?.id,
    //     },
    //     data: {
    //       status: 'PENDING_REVIEW',
    //     },
    //   });
    // }

    // await checkCurrentSubmission(data.submissionId);
  },
  {
    connection,
    concurrency: 3,
  },
);

uploadWorker.on('completed', (job) => {
  console.log('Upload completed');
  fs.unlinkSync(job.data.video.outputPath);
});

uploadWorker.on('failed', () => {
  console.log('Upload failed');
});

process.on('SIGTERM', async () => {
  await uploadWorker.close();
  process.exit(0);
});
