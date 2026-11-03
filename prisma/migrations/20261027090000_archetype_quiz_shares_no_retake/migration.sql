-- AlterTable
ALTER TABLE "CreatorArchetypeQuiz" DROP COLUMN "attemptCount",
ADD COLUMN     "firstSharedAt" TIMESTAMP(3),
ADD COLUMN     "instagramShareCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSharedAt" TIMESTAMP(3);

