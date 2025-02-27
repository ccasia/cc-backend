import { PrismaClient } from '@prisma/client';

export const getCreatorInvoiceLists = async (submissionId: string, prisma: PrismaClient) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        video: true,
        photos: true,
        rawFootages: true,
        dependentOn: {
          select: {
            dependentSubmission: {
              select: {
                video: true,
                photos: true,
                rawFootages: true,
              },
            },
          },
        },
        submissionType: {
          select: {
            type: true,
          },
        },
      },
    });

    if (!submission) throw new Error('Submission not found');

    let listItems: any;

    if (submission.submissionType.type === 'FINAL_DRAFT' && submission.status === 'APPROVED') {
      listItems = [
        ...(submission.dependentOn[0].dependentSubmission?.video
          ? [{ type: 'video', count: submission.dependentOn[0].dependentSubmission?.video.length }]
          : []),
        ...(submission.dependentOn[0].dependentSubmission?.photos?.length
          ? [{ type: 'photos', count: submission.dependentOn[0].dependentSubmission.photos.length }]
          : []),
        ...(submission.dependentOn[0].dependentSubmission?.rawFootages?.length
          ? [{ type: 'rawFootages', count: submission.dependentOn[0].dependentSubmission.rawFootages.length }]
          : []),
      ];
    } else {
      listItems = [
        ...(submission?.video ? [{ type: 'video', count: submission?.video.length }] : []),
        ...(submission?.photos?.length ? [{ type: 'photos', count: submission.photos.length }] : []),
        ...(submission?.rawFootages?.length ? [{ type: 'rawFootages', count: submission.rawFootages.length }] : []),
      ];
    }

    return listItems;
  } catch (error) {
    throw new Error(error);
  }
};
