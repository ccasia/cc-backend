-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('normal', 'meduim', 'urgent');

-- CreateEnum
CREATE TYPE "category" AS ENUM ('campaign', 'creator', 'brand');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "category" "category" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiver_id" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_id_key" ON "Notification"("id");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
