-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin', 'superadmin', 'creator', 'finance');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'user';
