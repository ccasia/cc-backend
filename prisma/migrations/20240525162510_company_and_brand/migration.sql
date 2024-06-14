-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(255),
    "website" VARCHAR(255),
    "address" VARCHAR(255) NOT NULL,
    "logo" VARCHAR(100),
    "about" VARCHAR(255),
    "objectives" JSONB,
    "registration_number" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(255),
    "website" VARCHAR(255),
    "logo" VARCHAR(255),
    "description" VARCHAR(255),
    "service_name" VARCHAR(255),
    "instagram" VARCHAR(255),
    "registration_number" TEXT NOT NULL,
    "tiktok" VARCHAR(255),
    "facebook" VARCHAR(255),
    "objectives" JSONB,
    "intersets" JSONB,
    "industries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupBrand" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(255),
    "tiktok" VARCHAR(255),
    "instagram" VARCHAR(255),
    "website" VARCHAR(255),
    "logo" VARCHAR(255),
    "registration_number" TEXT NOT NULL,
    "description" VARCHAR(255),
    "service_name" VARCHAR(255),
    "facebook" VARCHAR(255),
    "intersets" JSONB,
    "industries" JSONB,
    "objectives" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "SupBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupSupBrand" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(255),
    "tiktok" VARCHAR(255),
    "instagram" VARCHAR(255),
    "facebook" VARCHAR(255),
    "website" VARCHAR(255),
    "service_name" VARCHAR(255),
    "registration_number" TEXT NOT NULL,
    "logo" VARCHAR(255),
    "description" VARCHAR(255),
    "objectives" JSONB,
    "intersets" JSONB,
    "industries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supBrandId" TEXT NOT NULL,

    CONSTRAINT "SupSupBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'pending',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRequirnment" (
    "id" TEXT NOT NULL,
    "gender" VARCHAR(255) NOT NULL,
    "age" VARCHAR(255) NOT NULL,
    "geoLocation" VARCHAR(255) NOT NULL,
    "language" JSONB,
    "creator_persona" VARCHAR(255) NOT NULL,
    "user_persona" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "CampaignRequirnment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignBrief" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "objectives" VARCHAR(255) NOT NULL,
    "coverImage" VARCHAR(255) NOT NULL,
    "success" VARCHAR(255) NOT NULL,
    "campaigns_do" VARCHAR(255) NOT NULL,
    "campaigns_dont" VARCHAR(255) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "CampaignBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_id_key" ON "Company"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Company_registration_number_key" ON "Company"("registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_id_key" ON "Brand"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_registration_number_key" ON "Brand"("registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "SupBrand_id_key" ON "SupBrand"("id");

-- CreateIndex
CREATE UNIQUE INDEX "SupBrand_registration_number_key" ON "SupBrand"("registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "SupSupBrand_id_key" ON "SupSupBrand"("id");

-- CreateIndex
CREATE UNIQUE INDEX "SupSupBrand_registration_number_key" ON "SupSupBrand"("registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_key" ON "Campaign"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRequirnment_id_key" ON "CampaignRequirnment"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRequirnment_campaignId_key" ON "CampaignRequirnment"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBrief_id_key" ON "CampaignBrief"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBrief_campaignId_key" ON "CampaignBrief"("campaignId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupBrand" ADD CONSTRAINT "SupBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupSupBrand" ADD CONSTRAINT "SupSupBrand_supBrandId_fkey" FOREIGN KEY ("supBrandId") REFERENCES "SupBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Admin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRequirnment" ADD CONSTRAINT "CampaignRequirnment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBrief" ADD CONSTRAINT "CampaignBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
