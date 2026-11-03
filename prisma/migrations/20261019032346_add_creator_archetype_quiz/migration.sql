-- CreateEnum
CREATE TYPE "CreatorArchetype" AS ENUM ('MAIN_CHARACTER', 'PINTEREST_FINAL_BOSS', 'YAPPER', 'TREND_HOPPER', 'CONTROL_FREAK');

-- CreateTable
CREATE TABLE "CreatorArchetypeQuiz" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "archetype" "CreatorArchetype",
    "answers" JSONB,
    "scores" JSONB,
    "quizVersion" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "promptDismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorArchetypeQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorArchetypeQuiz_userId_key" ON "CreatorArchetypeQuiz"("userId");

-- AddForeignKey
ALTER TABLE "CreatorArchetypeQuiz" ADD CONSTRAINT "CreatorArchetypeQuiz_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
