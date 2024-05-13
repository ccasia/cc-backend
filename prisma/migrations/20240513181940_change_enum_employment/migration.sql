/*
  Warnings:

  - The values [parttime] on the enum `Employment` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Employment_new" AS ENUM ('fulltime', 'freelance', 'part_time', 'student', 'in_between', 'unemployed', 'others');
ALTER TABLE "Creator" ALTER COLUMN "employment" DROP DEFAULT;
ALTER TABLE "Creator" ALTER COLUMN "employment" TYPE "Employment_new" USING ("employment"::text::"Employment_new");
ALTER TYPE "Employment" RENAME TO "Employment_old";
ALTER TYPE "Employment_new" RENAME TO "Employment";
DROP TYPE "Employment_old";
ALTER TABLE "Creator" ALTER COLUMN "employment" SET DEFAULT 'others';
COMMIT;
