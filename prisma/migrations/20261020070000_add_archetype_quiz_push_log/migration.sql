-- CreateTable
CREATE TABLE "ArchetypeQuizPushLog" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "recipients" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ArchetypeQuizPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchetypeQuizPushLog_date_key" ON "ArchetypeQuizPushLog"("date");
