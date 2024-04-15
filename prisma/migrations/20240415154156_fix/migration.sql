/*
  Warnings:

  - A unique constraint covering the columns `[confirmationToken]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "confirmationToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Admin_confirmationToken_key" ON "Admin"("confirmationToken");
