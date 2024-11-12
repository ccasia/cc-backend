-- AlterTable
ALTER TABLE "CreatorAgreement" ADD COLUMN     "version" INTEGER DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "photoBackgroundURL" VARCHAR(255);

-- CreateTable
CREATE TABLE "AgreementTemplate" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgreementTemplate_id_key" ON "AgreementTemplate"("id");
