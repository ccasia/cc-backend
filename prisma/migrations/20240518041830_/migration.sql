-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_userId_fkey";

-- DropIndex
DROP INDEX "Event_userId_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "eventId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
