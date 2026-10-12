-- AlterEnum
ALTER TYPE "Entity" ADD VALUE 'CreatorNote';

-- CreateTable
CREATE TABLE "CreatorNote" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "pinnedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorNoteReadState" (
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "following" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CreatorNoteReadState_pkey" PRIMARY KEY ("userId","campaignId","creatorId")
);

-- CreateIndex
CREATE INDEX "CreatorNote_campaignId_creatorId_createdAt_idx" ON "CreatorNote"("campaignId", "creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorNoteReadState_campaignId_creatorId_idx" ON "CreatorNoteReadState"("campaignId", "creatorId");

-- AddForeignKey
ALTER TABLE "CreatorNote" ADD CONSTRAINT "CreatorNote_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorNote" ADD CONSTRAINT "CreatorNote_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorNote" ADD CONSTRAINT "CreatorNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorNoteReadState" ADD CONSTRAINT "CreatorNoteReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorNoteReadState" ADD CONSTRAINT "CreatorNoteReadState_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
