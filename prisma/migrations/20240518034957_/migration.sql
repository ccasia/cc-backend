/*
  Warnings:

  - Added the required column `allDay` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `color` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `end` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "allDay" BOOLEAN NOT NULL,
ADD COLUMN     "color" TEXT NOT NULL,
ADD COLUMN     "end" TEXT NOT NULL,
ADD COLUMN     "start" TEXT NOT NULL;
