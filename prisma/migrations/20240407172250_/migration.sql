/*
  Warnings:

  - A unique constraint covering the columns `[userID]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "receiver_id" INTEGER NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_receiver_id_key" ON "Notification"("receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userID_key" ON "Admin"("userID");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
