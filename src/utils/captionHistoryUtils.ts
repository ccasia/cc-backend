import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Saves NEW caption to history when it's created or updated
 * Records who wrote/updated the caption
 */
export const saveCaptionToHistory = async (
  submissionId: string,
  newCaption: string | null | undefined,
  author: string, // userId or adminId who wrote this caption
  authorType: 'creator' | 'admin',
) => {
  // Get current submission caption to check if it's changing
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { caption: true },
  });

  if (!submission) {
    return;
  }

  // Only save if caption is actually changing
  if (newCaption === submission.caption) {
    return;
  }

  // Save the NEW caption to history with who wrote it
  if (newCaption) {
    await prisma.captionHistory.create({
      data: {
        submissionId: submissionId,
        caption: newCaption,
        author: author,
        authorType: authorType,
      },
    });
  }
};
