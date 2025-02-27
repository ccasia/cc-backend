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
      },
    });

    if (!submission) throw new Error('Submission not found');

    const listItems = [
      ...(submission?.video ? [{ type: 'video', count: submission?.video.length }] : []),
      ...(submission?.photos?.length ? [{ type: 'photos', count: submission.photos.length }] : []),
      ...(submission?.rawFootages?.length ? [{ type: 'rawFootages', count: submission.rawFootages.length }] : []),
    ];

    return listItems;
  } catch (error) {
    throw new Error(error);
  }
};
