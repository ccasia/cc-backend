/*
  Warnings:

  - You are about to drop the column `coverImage` on the `CampaignBrief` table. All the data in the column will be lost.
  - The `campaigns_do` column on the `CampaignBrief` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `campaigns_dont` column on the `CampaignBrief` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `language` on the `CampaignRequirement` table. The data in that column could be lost. The data in that column will be cast from `JsonB` to `VarChar(255)`.
  - Added the required column `brandId` to the `Campaign` table without a default value. This is not possible if the table is not empty.
  - Added the required column `agreementFrom` to the `CampaignBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endDate` to the `CampaignBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `CampaignBrief` table without a default value. This is not possible if the table is not empty.
  - Made the column `language` on table `CampaignRequirement` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('publish', 'draft');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "brandId" TEXT NOT NULL,
ADD COLUMN     "stage" "Stage" NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "CampaignBrief" DROP COLUMN "coverImage",
ADD COLUMN     "agreementFrom" VARCHAR(255) NOT NULL,
ADD COLUMN     "endDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "images" JSONB,
ADD COLUMN     "industries" JSONB,
ADD COLUMN     "interests" JSONB,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "success" DROP NOT NULL,
DROP COLUMN "campaigns_do",
ADD COLUMN     "campaigns_do" JSONB,
DROP COLUMN "campaigns_dont",
ADD COLUMN     "campaigns_dont" JSONB;

-- AlterTable
ALTER TABLE "CampaignRequirement" ALTER COLUMN "language" SET NOT NULL,
ALTER COLUMN "language" SET DATA TYPE VARCHAR(255);

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
