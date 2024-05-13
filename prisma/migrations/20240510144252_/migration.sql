/*
  Warnings:

  - You are about to drop the column `country` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `photoURL` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `Nationality` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Creator` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "country",
DROP COLUMN "name",
DROP COLUMN "phoneNumber",
DROP COLUMN "photoURL",
DROP COLUMN "status",
ALTER COLUMN "designation" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "Nationality",
DROP COLUMN "phone",
DROP COLUMN "status",
ADD COLUMN     "nationality" VARCHAR(100);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "country" VARCHAR(100),
ADD COLUMN     "name" VARCHAR(255),
ADD COLUMN     "phoneNumber" VARCHAR(100),
ADD COLUMN     "photoURL" VARCHAR(255),
ADD COLUMN     "status" "Status" NOT NULL DEFAULT 'pending';
