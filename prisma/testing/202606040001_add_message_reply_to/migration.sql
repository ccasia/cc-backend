ALTER TABLE "Message" ADD COLUMN "replyToId" INTEGER;
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
