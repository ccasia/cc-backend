import { prisma } from 'src/prisma/prisma';

export const updateSubmissionStatus = async (submissionId: string) => {
  const videos = await prisma.video.findMany({
    where: { submissionId },
    select: { uploadStatus: true },
  });

  const allDone = videos.every((v) => v.uploadStatus === 'COMPLETED' || v.uploadStatus === 'FAILED');
  if (!allDone) return;

  const anyFailed = videos.some((v) => v.uploadStatus === 'FAILED');
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
