-- CreateTable
CREATE TABLE "insight_ocr_result" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "screenshots" JSONB NOT NULL,
    "totalCostUsd" DOUBLE PRECISION NOT NULL,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insight_ocr_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insight_ocr_result_createdById_createdAt_idx" ON "insight_ocr_result"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "insight_ocr_result" ADD CONSTRAINT "insight_ocr_result_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

