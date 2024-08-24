-- AlterTable
ALTER TABLE "SubmissionDependency" ALTER COLUMN "submissionId" DROP NOT NULL,
ALTER COLUMN "dependentSubmissionId" DROP NOT NULL;
