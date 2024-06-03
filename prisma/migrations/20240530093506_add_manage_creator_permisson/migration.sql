-- CreateTable
CREATE TABLE "ManageCreatorPermission" (
    "id" TEXT NOT NULL,
    "read" BOOLEAN,
    "write" BOOLEAN,
    "adminId" TEXT NOT NULL,

    CONSTRAINT "ManageCreatorPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManageCreatorPermission_id_key" ON "ManageCreatorPermission"("id");

-- CreateIndex
CREATE UNIQUE INDEX "ManageCreatorPermission_adminId_key" ON "ManageCreatorPermission"("adminId");

-- AddForeignKey
ALTER TABLE "ManageCreatorPermission" ADD CONSTRAINT "ManageCreatorPermission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
