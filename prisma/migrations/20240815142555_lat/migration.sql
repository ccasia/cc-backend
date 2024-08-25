/*
  Warnings:

  - You are about to drop the column `designation` on the `Admin` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "RoleEnum" ADD VALUE 'finance';

-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "designation",
ADD COLUMN     "roleId" TEXT;

-- DropEnum
DROP TYPE "PermissionsEnum";

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permisions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RolePermission" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_id_key" ON "Role"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Permisions_id_key" ON "Permisions"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Permisions_name_key" ON "Permisions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "_RolePermission_AB_unique" ON "_RolePermission"("A", "B");

-- CreateIndex
CREATE INDEX "_RolePermission_B_index" ON "_RolePermission"("B");

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermission" ADD CONSTRAINT "_RolePermission_A_fkey" FOREIGN KEY ("A") REFERENCES "Permisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermission" ADD CONSTRAINT "_RolePermission_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
