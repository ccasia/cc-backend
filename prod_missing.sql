-- CreateEnum
CREATE TYPE "public"."InvoiceType" AS ENUM ('STANDARD', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "public"."ReimbursementStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."Entity" ADD VALUE 'Reimbursement';
ALTER TYPE "public"."Entity" ADD VALUE 'CreatorNote';

-- AlterTable
ALTER TABLE "public"."CreatorAgreement" ADD COLUMN     "budgetAmount" DECIMAL(12,2),
ADD COLUMN     "isReceiptRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiptsSubmittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Invoice" ADD COLUMN     "invoiceType" "public"."InvoiceType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "parentInvoiceId" TEXT,
ADD COLUMN     "reimbursements" JSONB;

-- AlterTable
ALTER TABLE "public"."RawFootage" ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."SubmissionComment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Video" ADD COLUMN     "thumbnailUrl" TEXT;

-- CreateTable
CREATE TABLE "public"."CreatorNote" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "pinnedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreatorNoteReadState" (
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "following" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CreatorNoteReadState_pkey" PRIMARY KEY ("userId","campaignId","creatorId")
);

-- CreateTable
CREATE TABLE "public"."ReimbursementReceipt" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "description" TEXT NOT NULL,
    "status" "public"."ReimbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "financeNote" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorNote_campaignId_creatorId_createdAt_idx" ON "public"."CreatorNote"("campaignId" ASC, "creatorId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CreatorNoteReadState_campaignId_creatorId_idx" ON "public"."CreatorNoteReadState"("campaignId" ASC, "creatorId" ASC);

-- CreateIndex
CREATE INDEX "ReimbursementReceipt_agreementId_idx" ON "public"."ReimbursementReceipt"("agreementId" ASC);

-- CreateIndex
CREATE INDEX "ReimbursementReceipt_campaignId_userId_round_idx" ON "public"."ReimbursementReceipt"("campaignId" ASC, "userId" ASC, "round" ASC);

-- AddForeignKey
ALTER TABLE "public"."CreatorNote" ADD CONSTRAINT "CreatorNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreatorNote" ADD CONSTRAINT "CreatorNote_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreatorNote" ADD CONSTRAINT "CreatorNote_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreatorNoteReadState" ADD CONSTRAINT "CreatorNoteReadState_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreatorNoteReadState" ADD CONSTRAINT "CreatorNoteReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReimbursementReceipt" ADD CONSTRAINT "ReimbursementReceipt_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "public"."CreatorAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

