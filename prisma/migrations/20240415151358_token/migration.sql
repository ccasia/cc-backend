/*
  Warnings:

  - The values [normal,afiq,mohand] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `linke` on the `emailInvite` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[confirmationToken]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[link]` on the table `emailInvite` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[key]` on the table `emailInvite` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `confirmationToken` to the `Admin` table without a default value. This is not possible if the table is not empty.
  - Added the required column `key` to the `emailInvite` table without a default value. This is not possible if the table is not empty.
  - Added the required column `link` to the `emailInvite` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'inactive');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('user', 'admin', 'superadmin', 'creator', 'finance');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'user';
COMMIT;

-- DropIndex
DROP INDEX "emailInvite_linke_key";

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "confirmationToken" VARCHAR(255) NOT NULL,
ADD COLUMN     "status" "Status" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "emailInvite" DROP COLUMN "linke",
ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "link" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Admin_confirmationToken_key" ON "Admin"("confirmationToken");

-- CreateIndex
CREATE UNIQUE INDEX "emailInvite_link_key" ON "emailInvite"("link");

-- CreateIndex
CREATE UNIQUE INDEX "emailInvite_key_key" ON "emailInvite"("key");
