import { prisma } from 'src/prisma/prisma';

// V2 = FIRST_DRAFT and FINAL_DRAFT
// V4 = VIDEO

type SubmissionVersion = 'v2' | 'v4' | undefined;

export const updateSubmissionStatus = async (submissionId: string) => {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId },
    select: {
      submissionVersion: true,
    },
  });

  const version = submission?.submissionVersion as SubmissionVersion;

  if (version === 'v2' || !version) {
    handleV2Submission();
  } else if (version === 'v4') {
    handleV4Submission();
  }

  const videos = await prisma.video.findMany({
    where: { submissionId },
    select: { uploadStatus: true },
  });

  const allDone = videos.every((v) => v.uploadStatus === 'COMPLETED' || v.uploadStatus === 'FAILED');

  if (!allDone) return;

  const allCompleted = videos.every((v) => v.uploadStatus === 'COMPLETED');

  if (allCompleted) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'PENDING_REVIEW',
      },
    });
  }
};

const handleV2Submission = async () => {
  console.log('V2');
};

const handleV4Submission = async () => {
  console.log('V4');
};
