-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_userId_fkey";

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Admin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
