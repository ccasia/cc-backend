/*
  Warnings:

  - You are about to drop the column `valueMYR` on the `PackagesClient` table. All the data in the column will be lost.
  - You are about to drop the column `valueSGD` on the `PackagesClient` table. All the data in the column will be lost.
  - Added the required column `currency` to the `PackagesClient` table without a default value. This is not possible if the table is not empty.
  - Added the required column `states` to the `PackagesClient` table without a default value. This is not possible if the table is not empty.
  - Added the required column `value` to the `PackagesClient` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "pakcageStatus" AS ENUM ('active', 'inactive', 'expired');

-- AlterTable
ALTER TABLE "PackagesClient" DROP COLUMN "valueMYR",
DROP COLUMN "valueSGD",
ADD COLUMN     "currency" "Currencies" NOT NULL,
ADD COLUMN     "states" "pakcageStatus" NOT NULL,
ADD COLUMN     "value" INTEGER NOT NULL;
