-- CreateTable
CREATE TABLE "emailInvite" (
    "id" TEXT NOT NULL,
    "linke" TEXT NOT NULL,

    CONSTRAINT "emailInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emailInvite_id_key" ON "emailInvite"("id");

-- CreateIndex
CREATE UNIQUE INDEX "emailInvite_linke_key" ON "emailInvite"("linke");
