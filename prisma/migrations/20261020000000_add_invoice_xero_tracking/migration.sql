-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "xeroApprovedById" TEXT,
ADD COLUMN     "xeroAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "xeroAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xeroBillNumber" TEXT,
ADD COLUMN     "xeroError" TEXT,
ADD COLUMN     "xeroTenantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_xeroBillNumber_key" ON "Invoice"("xeroBillNumber");

