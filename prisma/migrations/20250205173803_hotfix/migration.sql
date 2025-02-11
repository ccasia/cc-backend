/*
  Warnings:

  - A unique constraint covering the columns `[companyId]` on the table `PackagesClient` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "PackagesClient_companyId_key" ON "PackagesClient"("companyId");
