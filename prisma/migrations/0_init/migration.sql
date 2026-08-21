-- CreateEnum
CREATE TYPE "AgreementTemplateType" AS ENUM ('seedingCampaign', 'surfSharkCampaign');

-- CreateEnum
CREATE TYPE "ApprovalCreatorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CampaignAdminRole" AS ENUM ('owner', 'viewer', 'editor', 'manager');

-- CreateEnum
CREATE TYPE "CampaignDraftOrigin" AS ENUM ('BD_CREATED', 'CLIENT_INVITED', 'CSL_CREATED', 'CSM_CREATED');

-- CreateEnum
CREATE TYPE "CampaignDraftStatus" AS ENUM ('DRAFTED', 'SENT_TO_CLIENT', 'PENDING_REVIEW', 'APPROVED', 'HANDED_OVER', 'LOST');

-- CreateEnum
CREATE TYPE "CampaignOrigin" AS ENUM ('ADMIN', 'CLIENT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'SCHEDULED', 'PENDING_CSM_REVIEW', 'PENDING_ADMIN_ACTIVATION');

-- CreateEnum
CREATE TYPE "CampaignTimelineStatus" AS ENUM ('close', 'active');

-- CreateEnum
CREATE TYPE "ClientCampaignRole" AS ENUM ('owner', 'viewer', 'editor', 'approver');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('directClient', 'agencyClient', 'enterpriseClient', 'demoClient');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('agency', 'directClient');

-- CreateEnum
CREATE TYPE "Currencies" AS ENUM ('MYR', 'SGD');

-- CreateEnum
CREATE TYPE "Designation" AS ENUM ('Finance', 'CSM', 'BD', 'Growth', 'CSL');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('Pending', 'Submitted', 'Request_For_Edit', 'Reviewed', 'Approved');

-- CreateEnum
CREATE TYPE "Employment" AS ENUM ('fulltime', 'freelance', 'part_time', 'student', 'in_between', 'unemployed', 'others');

-- CreateEnum
CREATE TYPE "Entity" AS ENUM ('Campaign', 'Live', 'Status', 'User', 'Pitch', 'Shortlist', 'Timeline', 'Feedback', 'Draft', 'Post', 'Logistic', 'Invoice', 'Metrcis', 'Agreement', 'Chat', 'PaymentForm', 'AdminAgreementForm', 'AdminFirstDraft', 'AdminFinalDraft', 'AdminPosting', 'ClientAgreementForm', 'ClientFirstDraft', 'ClientFinalDraft', 'ClientPosting', 'AgreementForm', 'FirstDraft', 'FinalDraft', 'Posting', 'Creator');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'SENT_TO_CLIENT', 'CLIENT_FEEDBACK');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('COMMENT', 'REASON', 'REQUEST');

-- CreateEnum
CREATE TYPE "FlowType" AS ENUM ('CAMPAIGN_CREATION', 'CREATOR_ONBOARDING');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'paid', 'overdue', 'draft', 'pending_approval', 'pending_payment', 'approved', 'rejected', 'processing', 'failed');

-- CreateEnum
CREATE TYPE "LogisticIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LogisticStatus" AS ENUM ('PENDING_ASSIGNMENT', 'SCHEDULED', 'SHIPPED', 'DELIVERED', 'RECEIVED', 'COMPLETED', 'ISSUE_REPORTED', 'ISSUE_RESOLVED', 'CANCELLED', 'NOT_STARTED');

-- CreateEnum
CREATE TYPE "LogisticType" AS ENUM ('PRODUCT_DELIVERY', 'RESERVATION');

-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('god', 'normal', 'advanced');

-- CreateEnum
CREATE TYPE "Modules" AS ENUM ('creator', 'campaign', 'brand', 'metric', 'invoice');

-- CreateEnum
CREATE TYPE "NpsUserType" AS ENUM ('CLIENT', 'CREATOR');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('OUTREACHED', 'DISCUSSING', 'CONFIRMED', 'REJECTED', 'INTERESTED', 'FOLLOWED_UP', 'UNRESPONSIVE');

-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('Trail', 'Basic', 'Essential', 'Pro', 'Custom');

-- CreateEnum
CREATE TYPE "PaymentFormStatus" AS ENUM ('rejected', 'approved');

-- CreateEnum
CREATE TYPE "PitchStatus" AS ENUM ('pending', 'approved', 'rejected', 'filtered', 'undecided', 'draft', 'PENDING_REVIEW', 'SENT_TO_CLIENT', 'APPROVED', 'MAYBE', 'REJECTED', 'AGREEMENT_PENDING', 'AGREEMENT_SUBMITTED', 'WITHDRAWN', 'INVITED', 'AWAITING_APPROVAL');

-- CreateEnum
CREATE TYPE "PitchType" AS ENUM ('video', 'text', 'shortlisted', 'pitch');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReservationMode" AS ENUM ('MANUAL_CONFIRMATION', 'AUTO_SCHEDULE');

-- CreateEnum
CREATE TYPE "Resources" AS ENUM ('creator', 'brand', 'campaign');

-- CreateEnum
CREATE TYPE "RoleEnum" AS ENUM ('admin', 'creator', 'brand', 'superadmin', 'finance', 'client', 'client_demo');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('PROPOSED', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('instagram', 'tiktok');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('publish', 'draft');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'pending', 'banned', 'rejected', 'blacklisted', 'suspended', 'spam', 'guest', 'deleted');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubmissionEnum" AS ENUM ('AGREEMENT_FORM', 'FIRST_DRAFT', 'FINAL_DRAFT', 'POSTING', 'OTHER', 'VIDEO', 'PHOTO', 'RAW_FOOTAGE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ON_HOLD', 'OVERDUE', 'CHANGES_REQUIRED', 'POSTED', 'SENT_TO_CLIENT', 'CLIENT_APPROVED', 'CLIENT_FEEDBACK', 'SENT_TO_ADMIN', 'SENT_TO_SUPERADMIN', 'APPROVE_LINK');

-- CreateEnum
CREATE TYPE "SubscriptionChangeType" AS ENUM ('NEW_PACKAGE', 'RENEWAL', 'UPGRADE', 'DOWNGRADE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED', 'TO_DO', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "TimelineStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TypeEnum" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('INITIATED', 'UPLOADING', 'RAW_UPLOAD_COMPLETE', 'QUEUED_FOR_COMPRESSION', 'COMPRESSING', 'COMPRESSION_FAILED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('Uploaded', 'Processing', 'Published', 'Rejected');

-- CreateEnum
CREATE TYPE "pakcageStatus" AS ENUM ('active', 'inactive', 'expired');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL DEFAULT 'normal',
    "inviteToken" TEXT,
    "userId" TEXT NOT NULL,
    "roleId" TEXT,
    "xeroTokenSet" JSONB,
    "bdInviteToken" TEXT,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "adminId" TEXT,
    "performedBy" TEXT,

    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPermissionModule" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "AdminPermissionModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementTemplate" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "adminName" TEXT,
    "adminICNumber" TEXT,
    "signURL" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "isDefault" BOOLEAN DEFAULT false,
    "agreementTemplateType" "AgreementTemplateType",

    CONSTRAINT "AgreementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "approverEmail" TEXT NOT NULL,
    "inviteToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequestCreator" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "pitchId" TEXT NOT NULL,
    "status" "ApprovalCreatorStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "csComment" TEXT,

    CONSTRAINT "ApprovalRequestCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookMarkCampaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "BookMarkCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookMarkCreator" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listId" TEXT NOT NULL,

    CONSTRAINT "BookMarkCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookMarkCreatorList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookMarkCreatorList_pkey" PRIMARY KEY ("id")
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
    "tiktok" VARCHAR(255),
    "facebook" VARCHAR(255),
    "objectives" JSONB,
    "industries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bugs" (
    "id" TEXT NOT NULL,
    "stepsToReproduce" TEXT NOT NULL,
    "attachment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "campaignName" TEXT,
    "attachments" TEXT[],

    CONSTRAINT "Bugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "brandId" TEXT,
    "companyId" TEXT,
    "brandTone" TEXT,
    "productName" TEXT,
    "eventId" TEXT,
    "agreementTemplateId" TEXT,
    "spreadSheetURL" TEXT,
    "rawFootage" BOOLEAN NOT NULL DEFAULT false,
    "photos" BOOLEAN NOT NULL DEFAULT false,
    "campaignCredits" INTEGER,
    "campaignId" TEXT,
    "ads" BOOLEAN NOT NULL DEFAULT false,
    "creditsPending" INTEGER,
    "creditsUtilized" INTEGER,
    "crossPosting" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionId" TEXT,
    "isKWSPCampaign" BOOLEAN DEFAULT false,
    "origin" "CampaignOrigin" NOT NULL DEFAULT 'ADMIN',
    "submissionVersion" TEXT DEFAULT 'v4',
    "logisticsType" "LogisticType",
    "isCreditTier" BOOLEAN NOT NULL DEFAULT false,
    "brandAbout" TEXT,
    "websiteLink" TEXT,
    "isForSurfShark" BOOLEAN,
    "completedAt" TIMESTAMP(3),
    "isPCRReady" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "creditAllocationBreakdown" JSONB,
    "bdInviteToken" TEXT,
    "approvedAt" TIMESTAMP(3),
    "briefOwnerId" TEXT,
    "clientBriefSnapshot" JSONB,
    "clientEmail" TEXT,
    "clientMagicToken" TEXT,
    "clientName" TEXT,
    "clientPackage" TEXT,
    "clientTokenExpiresAt" TIMESTAMP(3),
    "draftOrigin" "CampaignDraftOrigin",
    "draftStatus" "CampaignDraftStatus",
    "editedByClientFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handedOverAt" TIMESTAMP(3),
    "internalComments" TEXT,
    "sentToClientAt" TIMESTAMP(3),
    "lostAmount" DOUBLE PRECISION,
    "lostCurrency" TEXT,
    "lostReason" TEXT,
    "brandName" TEXT,
    "lostAt" TIMESTAMP(3),
    "onHoldAt" TIMESTAMP(3),
    "wonAmount" DOUBLE PRECISION,
    "wonCurrency" TEXT,
    "isForMobile" BOOLEAN NOT NULL DEFAULT false,
    "summaryUrl" TEXT,
    "campaignType" TEXT DEFAULT 'normal',

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAdditionalDetails" (
    "id" TEXT NOT NULL,
    "contentFormat" TEXT[],
    "mainMessage" TEXT,
    "keyPoints" TEXT,
    "toneAndStyle" TEXT,
    "brandGuidelinesUrl" TEXT,
    "referenceContent" TEXT,
    "productImage1Url" TEXT,
    "productImage2Url" TEXT,
    "hashtagsToUse" TEXT,
    "mentionsTagsRequired" TEXT,
    "creatorCompensation" TEXT,
    "ctaDesiredAction" TEXT,
    "ctaLinkUrl" TEXT,
    "ctaPromoCode" TEXT,
    "ctaLinkInBioRequirements" TEXT,
    "specialNotesInstructions" TEXT,
    "needAds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "CampaignAdditionalDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAdmin" (
    "adminId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "CampaignAdminRole" NOT NULL DEFAULT 'viewer',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAdmin_pkey" PRIMARY KEY ("adminId","campaignId")
);

-- CreateTable
CREATE TABLE "CampaignBrief" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objectives" TEXT,
    "images" JSONB,
    "agreementFrom" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "interests" JSONB,
    "industries" TEXT,
    "success" TEXT,
    "socialMediaPlatform" TEXT[],
    "videoAngle" TEXT[],
    "campaigns_do" JSONB,
    "campaigns_dont" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT NOT NULL,
    "otherAttachments" TEXT[],
    "referencesLinks" TEXT[],
    "postingEndDate" TIMESTAMP(3),
    "postingStartDate" TIMESTAMP(3),
    "boostContent" TEXT,
    "performanceBaseline" TEXT,
    "primaryKPI" TEXT,
    "secondaryObjectives" TEXT[],

    CONSTRAINT "CampaignBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignClient" (
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "role" "ClientCampaignRole" NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignClient_pkey" PRIMARY KEY ("clientId","campaignId")
);

-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adminId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "CampaignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPCR" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPCR_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRequirement" (
    "id" TEXT NOT NULL,
    "gender" TEXT[],
    "age" TEXT[],
    "geoLocation" TEXT[],
    "language" TEXT[],
    "creator_persona" TEXT[],
    "user_persona" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "country" TEXT,
    "countries" TEXT[],
    "geographicFocusOthers" TEXT,
    "geographic_focus" TEXT,
    "secondary_age" TEXT[],
    "secondary_country" TEXT,
    "secondary_creator_persona" TEXT[],
    "secondary_gender" TEXT[],
    "secondary_geoLocation" TEXT[],
    "secondary_language" TEXT[],
    "secondary_user_persona" TEXT,

    CONSTRAINT "CampaignRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSubmissionRequirement" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSubmissionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTask" (
    "id" TEXT NOT NULL,
    "task" TEXT,
    "campaignTimelineId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "CampaignTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTaskAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignTaskId" TEXT NOT NULL,

    CONSTRAINT "CampaignTaskAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTimeline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "for" TEXT,
    "description" TEXT,
    "duration" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "TimelineStatus" NOT NULL DEFAULT 'OPEN',
    "submissionTypeId" TEXT,

    CONSTRAINT "CampaignTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptionHistory" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "caption" TEXT,
    "author" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "parentClientId" TEXT NOT NULL,
    "invitationToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientType" "ClientType" NOT NULL DEFAULT 'directClient',
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviteToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isParentAccount" BOOLEAN NOT NULL DEFAULT false,
    "parentClientId" TEXT,
    "demoAccessToken" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNotification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity" "Entity",
    "entityId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Columns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" SERIAL NOT NULL,
    "boardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentAgreement" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CommentAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "logo" TEXT,
    "about" TEXT,
    "objectives" JSONB,
    "registration_number" VARCHAR(150),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,
    "type" "CompanyType",

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crawler" (
    "id" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "engagement_rate" INTEGER NOT NULL,
    "avg_likes_per_post" INTEGER NOT NULL,
    "top_contents" JSONB[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crawler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "pronounce" VARCHAR(100),
    "address" TEXT,
    "state" TEXT,
    "location" TEXT,
    "birthDate" TIMESTAMP(3),
    "instagram" VARCHAR(100),
    "tiktok" VARCHAR(100),
    "xeroContactId" TEXT,
    "employment" "Employment" DEFAULT 'others',
    "languages" JSONB,
    "userId" TEXT NOT NULL,
    "industries" JSONB,
    "allowToChange" BOOLEAN NOT NULL DEFAULT false,
    "socialMediaUpdateCount" JSONB,
    "socialMediaData" JSONB,
    "isFormCompleted" BOOLEAN,
    "instagramData" JSONB,
    "isFacebookConnected" BOOLEAN NOT NULL DEFAULT false,
    "isOnBoardingFormCompleted" BOOLEAN,
    "isTiktokConnected" BOOLEAN NOT NULL DEFAULT false,
    "tiktokData" JSONB,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "profileLink" TEXT,
    "city" VARCHAR(100),
    "country" TEXT,
    "dietaryRestrictions" TEXT,
    "instagramProfileLink" VARCHAR(255),
    "postcode" VARCHAR(20),
    "tiktokProfileLink" VARCHAR(255),
    "creditTierId" TEXT,
    "manualFollowerCount" INTEGER DEFAULT 0,
    "tierUpdatedAt" TIMESTAMP(3),
    "formCompletedAt" TIMESTAMP(3),
    "manualInstagramFollowerCount" INTEGER DEFAULT 0,
    "manualTiktokFollowerCount" INTEGER DEFAULT 0,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorAgreement" (
    "id" TEXT NOT NULL,
    "agreementUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "amount" TEXT,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER DEFAULT 1,
    "approvedByAdminId" TEXT,
    "completedAt" TIMESTAMP(3),
    "currency" TEXT,

    CONSTRAINT "CreatorAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minFollowers" INTEGER NOT NULL,
    "maxFollowers" INTEGER,
    "creditsPerVideo" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPackage" (
    "id" TEXT NOT NULL,
    "customName" TEXT NOT NULL,
    "customCredits" INTEGER NOT NULL,
    "customValidityPeriod" INTEGER NOT NULL,
    "customPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPostEngagementSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postDate" TIMESTAMP(3) NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "daysSincePost" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saved" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" DOUBLE PRECISION NOT NULL,
    "rawMetrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPostEngagementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryDetails" (
    "id" TEXT NOT NULL,
    "trackingLink" TEXT,
    "address" TEXT,
    "expectedDeliveryDate" TIMESTAMP(3),
    "dietaryRestrictions" TEXT,
    "logisticId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeliveryDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryItem" (
    "id" TEXT NOT NULL,
    "deliveryDetailsId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DeliveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER DEFAULT 0,
    "lastSendAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "color" TEXT,
    "allDay" BOOLEAN NOT NULL,
    "userId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "content" TEXT,
    "type" "FeedbackType",
    "reasons" TEXT[],
    "submissionId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "photoContent" TEXT,
    "photosToUpdate" TEXT[],
    "rawFootageContent" TEXT,
    "rawFootageToUpdate" TEXT[],
    "videosToUpdate" TEXT[],
    "sentToCreator" BOOLEAN NOT NULL DEFAULT false,
    "submissionCommentId" TEXT,
    "videoId" TEXT,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Finance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "snapshotType" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "platform" TEXT NOT NULL,
    "totalPosts" INTEGER NOT NULL,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "totalLikes" INTEGER NOT NULL DEFAULT 0,
    "totalComments" INTEGER NOT NULL DEFAULT 0,
    "totalShares" INTEGER NOT NULL DEFAULT 0,
    "totalSaved" INTEGER NOT NULL DEFAULT 0,
    "totalReach" INTEGER NOT NULL DEFAULT 0,
    "averageEngagementRate" DOUBLE PRECISION NOT NULL,
    "topCreatorsByViews" JSONB,
    "dailyViewDeltas" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramUser" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "user_id" TEXT,
    "followers_count" INTEGER,
    "follows_count" INTEGER,
    "media_count" INTEGER,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accessToken" JSONB,
    "averageComments" DOUBLE PRECISION,
    "averageLikes" DOUBLE PRECISION,
    "expiresIn" INTEGER,
    "totalComments" INTEGER,
    "totalLikes" INTEGER,
    "engagement_rate" DOUBLE PRECISION,
    "lastUpdated" TIMESTAMP(3),
    "averageSaves" DOUBLE PRECISION,
    "averageShares" DOUBLE PRECISION,
    "biography" TEXT,
    "insightData" JSONB,
    "profile_picture_url" TEXT,
    "totalSaves" INTEGER,
    "totalShares" INTEGER,

    CONSTRAINT "InstagramUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramVideo" (
    "id" TEXT NOT NULL,
    "video_id" TEXT,
    "comments_count" INTEGER,
    "like_count" INTEGER,
    "media_type" TEXT,
    "media_url" TEXT,
    "thumbnail_url" TEXT,
    "caption" TEXT,
    "permalink" TEXT,
    "instagramUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "datePosted" TIMESTAMP(3),
    "shortCode" TEXT,
    "view_count" INTEGER,

    CONSTRAINT "InstagramVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "rank" INTEGER,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "task" JSONB,
    "bankAcc" JSONB,
    "invoiceFrom" JSONB,
    "invoiceTo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adminId" TEXT,
    "deliverables" JSONB,
    "xeroInvoiceId" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Logistic" (
    "id" TEXT NOT NULL,
    "status" "LogisticStatus" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "type" "LogisticType" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Logistic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticIssue" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LogisticIssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "logisticId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,

    CONSTRAINT "LogisticIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualCreatorEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "creatorUsername" TEXT NOT NULL,
    "photoUrl" TEXT,
    "platform" TEXT NOT NULL,
    "postUrl" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saved" INTEGER,
    "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualCreatorEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaKit" (
    "id" TEXT NOT NULL,
    "about" TEXT,
    "creatorId" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "MediaKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT,
    "senderId" TEXT,
    "file" TEXT,
    "fileType" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "fileHeight" INTEGER,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileWidth" INTEGER,
    "replyToId" INTEGER,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "name" "Modules" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entity" "Entity",
    "campaignId" TEXT,
    "creatorId" TEXT,
    "invoiceId" TEXT,
    "threadId" TEXT,
    "pitchId" TEXT,
    "submissionId" TEXT,
    "userId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpsFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userType" "NpsUserType" NOT NULL DEFAULT 'CLIENT',
    "rating" INTEGER NOT NULL,
    "feedback" TEXT,
    "deviceType" TEXT,
    "deviceModel" TEXT,
    "deviceVendor" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpsFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "credits" INTEGER NOT NULL,
    "validityPeriod" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentForm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "icNumber" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bodyMeasurement" TEXT,
    "allergies" TEXT[],
    "bankAccountName" TEXT,
    "countryOfBank" TEXT,
    "reason" TEXT,
    "status" "PaymentFormStatus" DEFAULT 'approved',

    CONSTRAINT "PaymentForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permisions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "campaignId" TEXT,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "updatedAt" TIMESTAMP(3),
    "userId" TEXT,
    "adminId" TEXT,
    "feedback" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "reasons" TEXT[],

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "brandId" TEXT,
    "email" TEXT,

    CONSTRAINT "Pic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pitch" (
    "id" TEXT NOT NULL,
    "type" "PitchType" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PitchStatus" DEFAULT 'pending',
    "content" TEXT NOT NULL DEFAULT 'test',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByAdminId" TEXT,
    "completedAt" TIMESTAMP(3),
    "adminCommentedBy" TEXT,
    "adminComments" TEXT,
    "agreementTemplateId" TEXT,
    "amount" INTEGER,
    "approvedByClientId" TEXT,
    "customRejectionText" TEXT,
    "maybeByClientId" TEXT,
    "rejectedByAdminId" TEXT,
    "rejectedByClientId" TEXT,
    "rejectionReason" TEXT,
    "ugcCredits" INTEGER,
    "engagementRate" TEXT,
    "followerCount" TEXT,
    "outreachStatus" "OutreachStatus",
    "outreachUpdatedAt" TIMESTAMP(3),
    "outreachUpdatedBy" TEXT,
    "acceptedInviteByCreatorId" TEXT,
    "isInvited" BOOLEAN NOT NULL DEFAULT false,
    "clientVisibleApprovalNote" TEXT,
    "selectedPlatform" "SocialPlatform",

    CONSTRAINT "Pitch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostEngagementSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDay" INTEGER NOT NULL,
    "postDate" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saved" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" DOUBLE PRECISION NOT NULL,
    "rawMetrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostEngagementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" SERIAL NOT NULL,
    "packageId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicAccess" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicFeedback" (
    "id" TEXT NOT NULL,
    "content" TEXT,
    "type" "FeedbackType",
    "reasons" TEXT[],
    "submissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawFootage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "campaignId" TEXT,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "updatedAt" TIMESTAMP(3),
    "userId" TEXT,
    "adminId" TEXT,
    "feedback" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "reasons" TEXT[],

    CONSTRAINT "RawFootage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationConfiguration" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mode" "ReservationMode" NOT NULL,
    "locations" JSONB NOT NULL,
    "availabilityRules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowMultipleBookings" BOOLEAN NOT NULL DEFAULT false,
    "clientRemarks" TEXT,

    CONSTRAINT "ReservationConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationDetails" (
    "id" TEXT NOT NULL,
    "logisticId" TEXT NOT NULL,
    "budget" TEXT,
    "clientRemarks" TEXT,
    "creatorRemarks" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "outlet" TEXT,
    "pax" INTEGER,
    "picContact" TEXT,
    "picName" TEXT,
    "promoCode" TEXT,

    CONSTRAINT "ReservationDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationSlot" (
    "id" TEXT NOT NULL,
    "reservationDetailsId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResetPasswordToken" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "userId" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResetPasswordToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeenMessage" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "SeenMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortListedCreator" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "shortlisted_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAgreementReady" BOOLEAN DEFAULT false,
    "isCampaignDone" BOOLEAN DEFAULT false,
    "isCreatorPaid" BOOLEAN DEFAULT false,
    "ugcVideos" INTEGER,
    "amount" INTEGER,
    "currency" TEXT,
    "adminComments" TEXT,
    "creditPerVideo" INTEGER,
    "creditTierId" TEXT,
    "followerCount" INTEGER,
    "selectedPlatform" "SocialPlatform",
    "adminRatedAt" TIMESTAMP(3),
    "adminRatedById" TEXT,
    "adminRating" INTEGER,
    "adminRatingNote" TEXT,
    "adminRatingTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientRatedAt" TIMESTAMP(3),
    "clientRatedById" TEXT,
    "clientRating" INTEGER,

    CONSTRAINT "ShortListedCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreVisitDetails" (
    "id" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "appointmentTime" TIMESTAMP(3) NOT NULL,
    "contactPerson" TEXT,
    "proofOfVisitUrl" TEXT,
    "logisticId" TEXT NOT NULL,

    CONSTRAINT "StoreVisitDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "content" TEXT,
    "caption" TEXT,
    "campaignId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submissionDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "submissionTypeId" TEXT NOT NULL,
    "isReview" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "videos" TEXT[],
    "approvedByAdminId" TEXT,
    "completedAt" TIMESTAMP(3),
    "photosDriveLink" TEXT,
    "rawFootagesDriveLink" TEXT,
    "nextsubmissionDate" TIMESTAMP(3),
    "submittedByAdminId" TEXT,
    "contentOrder" INTEGER,
    "submissionVersion" TEXT DEFAULT 'v2',
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionComment" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "editedText" TEXT,
    "timestamp" TEXT,
    "editedTimestamp" TEXT,
    "submissionId" TEXT NOT NULL,
    "videoId" TEXT,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "isClientDraft" BOOLEAN NOT NULL DEFAULT false,
    "isVisibleToCreator" BOOLEAN NOT NULL DEFAULT true,
    "isSentToCreator" BOOLEAN NOT NULL DEFAULT false,
    "forwardedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionDependency" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT,
    "dependentSubmissionId" TEXT,

    CONSTRAINT "SubmissionDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionPostingUrl" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3),
    "shortCode" TEXT,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionPostingUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionType" (
    "id" TEXT NOT NULL,
    "type" "SubmissionEnum" NOT NULL,
    "description" TEXT,

    CONSTRAINT "SubmissionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "companyId" TEXT,
    "packageId" TEXT,
    "customPackageId" TEXT,
    "currency" TEXT,
    "creditsUsed" INTEGER NOT NULL,
    "totalCredits" INTEGER,
    "packagePrice" DOUBLE PRECISION,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "changeType" "SubscriptionChangeType" NOT NULL,
    "previousPackageId" TEXT,
    "newPackageId" TEXT NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionByUserId" TEXT,

    CONSTRAINT "SubscriptionHistory_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT,
    "position" INTEGER NOT NULL,
    "priority" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "labels" TEXT[],
    "columnId" TEXT NOT NULL,
    "submissionId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photoURL" VARCHAR(255),
    "isGroup" BOOLEAN NOT NULL DEFAULT true,
    "campaignId" TEXT,
    "latestMessageId" INTEGER,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TiktokUser" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "following_count" INTEGER,
    "follower_count" INTEGER,
    "likes_count" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "averageComments" DOUBLE PRECISION,
    "averageLikes" DOUBLE PRECISION,
    "engagement_rate" DOUBLE PRECISION,
    "lastUpdated" TIMESTAMP(3),
    "totalComments" INTEGER,
    "totalLikes" INTEGER,
    "averageShares" DOUBLE PRECISION,
    "totalShares" INTEGER,
    "username" TEXT,
    "biography" TEXT,
    "analyticsData" JSONB,

    CONSTRAINT "TiktokUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TiktokVideo" (
    "id" TEXT NOT NULL,
    "video_id" TEXT,
    "cover_image_url" TEXT,
    "title" TEXT,
    "description" TEXT,
    "duration" DOUBLE PRECISION,
    "embed_link" TEXT,
    "embed_html" TEXT,
    "like_count" INTEGER,
    "comment_count" INTEGER,
    "share_count" INTEGER,
    "view_count" INTEGER,
    "tiktokUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TiktokVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineDefault" (
    "id" TEXT NOT NULL,
    "timelineTypeDefaultId" TEXT NOT NULL,
    "for" TEXT,
    "duration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "TimelineDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineTypeDefault" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineTypeDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnreadMessage" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,

    CONSTRAINT "UnreadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "gcsSessionUri" TEXT,
    "gcsObjectPath" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'INITIATED',
    "bytesTotal" BIGINT,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT,
    "submissionId" TEXT,
    "videoId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255),
    "name" VARCHAR(255),
    "photoURL" VARCHAR(255),
    "country" VARCHAR(100),
    "phoneNumber" VARCHAR(100),
    "status" "Status" NOT NULL DEFAULT 'pending',
    "eventId" TEXT,
    "xeroRefreshToken" TEXT,
    "updateRefershToken" TIMESTAMP(3),
    "role" "RoleEnum" NOT NULL,
    "photoBackgroundURL" VARCHAR(255),
    "googleId" TEXT,
    "city" VARCHAR(100),
    "hasSubmittedKWSP" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isKWSPCampaign" BOOLEAN DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationId" TEXT,
    "referralCode" VARCHAR(50),
    "activatedAt" TIMESTAMP(3),
    "mediaKitMandatory" BOOLEAN NOT NULL DEFAULT false,
    "passwordSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "twoFactorSecret" TEXT,
    "appleEmail" VARCHAR(255),
    "appleId" TEXT,
    "appleRefreshToken" TEXT,
    "appleUnlinkedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "googleEmail" VARCHAR(255),
    "googleUnlinkedAt" TIMESTAMP(3),
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFlow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "flow" "FlowType" NOT NULL,
    "step" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'STARTED',
    "timeSpentSeconds" INTEGER DEFAULT 0,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "archive" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserThread" (
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserThread_pkey" PRIMARY KEY ("userId","threadId")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "submissionId" TEXT,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "userId" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "adminId" TEXT,
    "feedback" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "reasons" TEXT[],
    "previousDrafts" TEXT[],
    "feedbackDeadline" TIMESTAMP(3),
    "feedbackSentByName" TEXT,
    "resubmittedFromId" TEXT,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoOfTheMonth" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "videoIndex" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "thumbnailUrl" TEXT,

    CONSTRAINT "VideoOfTheMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "from" TEXT,
    "to" TEXT,
    "message" TEXT,
    "sticker" JSONB,
    "type" TEXT,
    "status" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "direction" "TypeEnum",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RolePermission" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RolePermission_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_UserThreads" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserThreads_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "ai_model" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "systemPrompt" JSONB,
    "maxOutputTokens" INTEGER NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "ai_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp-setting" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT,
    "businessAccountId" TEXT,
    "phoneNumberId" TEXT,
    "templateName" TEXT,
    "isFeatureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp-setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_bdInviteToken_key" ON "Admin"("bdInviteToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_id_key" ON "Admin"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_inviteToken_key" ON "Admin"("inviteToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminLog_id_key" ON "AdminLog"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPermissionModule_id_key" ON "AdminPermissionModule"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AgreementTemplate_id_key" ON "AgreementTemplate"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_token_key" ON "ApprovalRequest"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequestCreator_approvalRequestId_pitchId_key" ON "ApprovalRequestCreator"("approvalRequestId" ASC, "pitchId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Board_id_key" ON "Board"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Board_userId_key" ON "Board"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookMarkCampaign_id_key" ON "BookMarkCampaign"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookMarkCampaign_userId_campaignId_key" ON "BookMarkCampaign"("userId" ASC, "campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookMarkCreator_id_key" ON "BookMarkCreator"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookMarkCreator_listId_creatorUserId_platform_key" ON "BookMarkCreator"("listId" ASC, "creatorUserId" ASC, "platform" ASC);

-- CreateIndex
CREATE INDEX "BookMarkCreator_listId_idx" ON "BookMarkCreator"("listId" ASC);

-- CreateIndex
CREATE INDEX "BookMarkCreator_userId_idx" ON "BookMarkCreator"("userId" ASC);

-- CreateIndex
CREATE INDEX "BookMarkCreatorList_userId_idx" ON "BookMarkCreatorList"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookMarkCreatorList_userId_name_key" ON "BookMarkCreatorList"("userId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_id_key" ON "Brand"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Bugs_id_key" ON "Bugs"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_clientMagicToken_key" ON "Campaign"("clientMagicToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_key" ON "Campaign"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAdditionalDetails_campaignId_key" ON "CampaignAdditionalDetails"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAdditionalDetails_id_key" ON "CampaignAdditionalDetails"("id" ASC);

-- CreateIndex
CREATE INDEX "CampaignAdmin_adminId_idx" ON "CampaignAdmin"("adminId" ASC);

-- CreateIndex
CREATE INDEX "CampaignAdmin_campaignId_idx" ON "CampaignAdmin"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBrief_campaignId_key" ON "CampaignBrief"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBrief_id_key" ON "CampaignBrief"("id" ASC);

-- CreateIndex
CREATE INDEX "CampaignClient_campaignId_idx" ON "CampaignClient"("campaignId" ASC);

-- CreateIndex
CREATE INDEX "CampaignClient_clientId_idx" ON "CampaignClient"("clientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLog_id_key" ON "CampaignLog"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPCR_campaignId_key" ON "CampaignPCR"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPCR_id_key" ON "CampaignPCR"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRequirement_campaignId_key" ON "CampaignRequirement"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRequirement_id_key" ON "CampaignRequirement"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSubmissionRequirement_campaignId_submissionTypeId_key" ON "CampaignSubmissionRequirement"("campaignId" ASC, "submissionTypeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTask_id_key" ON "CampaignTask"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTaskAdmin_userId_campaignTaskId_key" ON "CampaignTaskAdmin"("userId" ASC, "campaignTaskId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTimeline_id_key" ON "CampaignTimeline"("id" ASC);

-- CreateIndex
CREATE INDEX "CaptionHistory_createdAt_idx" ON "CaptionHistory"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "CaptionHistory_submissionId_idx" ON "CaptionHistory"("submissionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChildAccount_email_parentClientId_key" ON "ChildAccount"("email" ASC, "parentClientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChildAccount_id_key" ON "ChildAccount"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChildAccount_invitationToken_key" ON "ChildAccount"("invitationToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_demoAccessToken_key" ON "Client"("demoAccessToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_id_key" ON "Client"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_inviteToken_key" ON "Client"("inviteToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotification_id_key" ON "ClientNotification"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Columns_id_key" ON "Columns"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CommentAgreement_commentId_userId_key" ON "CommentAgreement"("commentId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "Company_clientId_idx" ON "Company"("clientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Company_clientId_key" ON "Company"("clientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Company_id_key" ON "Company"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Crawler_id_key" ON "Crawler"("id" ASC);

-- CreateIndex
CREATE INDEX "Creator_formCompletedAt_idx" ON "Creator"("formCompletedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_id_key" ON "Creator"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_userId_key" ON "Creator"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAgreement_id_key" ON "CreatorAgreement"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAgreement_userId_campaignId_key" ON "CreatorAgreement"("userId" ASC, "campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreditTier_id_key" ON "CreditTier"("id" ASC);

-- CreateIndex
CREATE INDEX "CreditTier_minFollowers_idx" ON "CreditTier"("minFollowers" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreditTier_name_key" ON "CreditTier"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CustomPackage_id_key" ON "CustomPackage"("id" ASC);

-- CreateIndex
CREATE INDEX "DailyPostEngagementSnapshot_campaignId_snapshotDate_idx" ON "DailyPostEngagementSnapshot"("campaignId" ASC, "snapshotDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DailyPostEngagementSnapshot_id_key" ON "DailyPostEngagementSnapshot"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DailyPostEngagementSnapshot_postUrl_snapshotDate_key" ON "DailyPostEngagementSnapshot"("postUrl" ASC, "snapshotDate" ASC);

-- CreateIndex
CREATE INDEX "DailyPostEngagementSnapshot_submissionId_snapshotDate_idx" ON "DailyPostEngagementSnapshot"("submissionId" ASC, "snapshotDate" ASC);

-- CreateIndex
CREATE INDEX "DailyPostEngagementSnapshot_userId_snapshotDate_idx" ON "DailyPostEngagementSnapshot"("userId" ASC, "snapshotDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryDetails_id_key" ON "DeliveryDetails"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryDetails_logisticId_key" ON "DeliveryDetails"("logisticId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryItem_deliveryDetailsId_productId_key" ON "DeliveryItem"("deliveryDetailsId" ASC, "productId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryItem_id_key" ON "DeliveryItem"("id" ASC);

-- CreateIndex
CREATE INDEX "DemoCampaign_clientId_idx" ON "DemoCampaign"("clientId" ASC);

-- CreateIndex
CREATE INDEX "DemoCampaign_companyId_idx" ON "DemoCampaign"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DemoCampaign_id_key" ON "DemoCampaign"("id" ASC);

-- CreateIndex
CREATE INDEX "DemoCampaign_userId_idx" ON "DemoCampaign"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_id_key" ON "EmailVerification"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_key" ON "Event"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_id_key" ON "Feedback"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_submissionCommentId_key" ON "Feedback"("submissionCommentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Finance_id_key" ON "Finance"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Finance_userId_key" ON "Finance"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InsightSnapshot_campaignId_platform_snapshotDate_key" ON "InsightSnapshot"("campaignId" ASC, "platform" ASC, "snapshotDate" ASC);

-- CreateIndex
CREATE INDEX "InsightSnapshot_campaignId_snapshotDate_idx" ON "InsightSnapshot"("campaignId" ASC, "snapshotDate" ASC);

-- CreateIndex
CREATE INDEX "InsightSnapshot_campaignId_snapshotType_idx" ON "InsightSnapshot"("campaignId" ASC, "snapshotType" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InsightSnapshot_id_key" ON "InsightSnapshot"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramUser_creatorId_key" ON "InstagramUser"("creatorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramUser_id_key" ON "InstagramUser"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramUser_user_id_key" ON "InstagramUser"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramVideo_id_key" ON "InstagramVideo"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramVideo_video_id_key" ON "InstagramVideo"("video_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Interest_id_key" ON "Interest"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_key" ON "Invoice"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber" ASC);

-- CreateIndex
CREATE INDEX "Logistic_campaignId_idx" ON "Logistic"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Logistic_creatorId_campaignId_key" ON "Logistic"("creatorId" ASC, "campaignId" ASC);

-- CreateIndex
CREATE INDEX "Logistic_creatorId_idx" ON "Logistic"("creatorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Logistic_id_key" ON "Logistic"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LogisticIssue_id_key" ON "LogisticIssue"("id" ASC);

-- CreateIndex
CREATE INDEX "ManualCreatorEntry_campaignId_idx" ON "ManualCreatorEntry"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ManualCreatorEntry_id_key" ON "ManualCreatorEntry"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MediaKit_creatorId_key" ON "MediaKit"("creatorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MediaKit_id_key" ON "MediaKit"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Module_id_key" ON "Module"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_id_key" ON "Notification"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "NpsFeedback_id_key" ON "NpsFeedback"("id" ASC);

-- CreateIndex
CREATE INDEX "NpsFeedback_userId_idx" ON "NpsFeedback"("userId" ASC);

-- CreateIndex
CREATE INDEX "NpsFeedback_userType_idx" ON "NpsFeedback"("userType" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Package_id_key" ON "Package"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentForm_id_key" ON "PaymentForm"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentForm_userId_key" ON "PaymentForm"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Permisions_id_key" ON "Permisions"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Permisions_name_key" ON "Permisions"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_id_key" ON "Permission"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Pic_id_key" ON "Pic"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Pitch_id_key" ON "Pitch"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Pitch_userId_campaignId_key" ON "Pitch"("userId" ASC, "campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PostEngagementSnapshot_campaignId_postUrl_snapshotDay_key" ON "PostEngagementSnapshot"("campaignId" ASC, "postUrl" ASC, "snapshotDay" ASC);

-- CreateIndex
CREATE INDEX "PostEngagementSnapshot_campaignId_snapshotDay_idx" ON "PostEngagementSnapshot"("campaignId" ASC, "snapshotDay" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PostEngagementSnapshot_id_key" ON "PostEngagementSnapshot"("id" ASC);

-- CreateIndex
CREATE INDEX "PostEngagementSnapshot_submissionId_idx" ON "PostEngagementSnapshot"("submissionId" ASC);

-- CreateIndex
CREATE INDEX "PostEngagementSnapshot_userId_idx" ON "PostEngagementSnapshot"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Price_packageId_currency_key" ON "Price"("packageId" ASC, "currency" ASC);

-- CreateIndex
CREATE INDEX "Product_campaignId_idx" ON "Product"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_key" ON "Product"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PublicFeedback_id_key" ON "PublicFeedback"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token" ASC);

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationConfiguration_campaignId_key" ON "ReservationConfiguration"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationConfiguration_id_key" ON "ReservationConfiguration"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationDetails_id_key" ON "ReservationDetails"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationDetails_logisticId_key" ON "ReservationDetails"("logisticId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSlot_id_key" ON "ReservationSlot"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ResetPasswordToken_id_key" ON "ResetPasswordToken"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ResetPasswordToken_userId_key" ON "ResetPasswordToken"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Role_id_key" ON "Role"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Role_slug_key" ON "Role"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SeenMessage_userId_messageId_key" ON "SeenMessage"("userId" ASC, "messageId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_sid_key" ON "Session"("sid" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ShortListedCreator_userId_campaignId_key" ON "ShortListedCreator"("userId" ASC, "campaignId" ASC);

-- CreateIndex
CREATE INDEX "ShortListedCreator_userId_idx" ON "ShortListedCreator"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StoreVisitDetails_id_key" ON "StoreVisitDetails"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StoreVisitDetails_logisticId_key" ON "StoreVisitDetails"("logisticId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_userId_campaignId_submissionTypeId_contentOrder_key" ON "Submission"("userId" ASC, "campaignId" ASC, "submissionTypeId" ASC, "contentOrder" ASC);

-- CreateIndex
CREATE INDEX "SubmissionComment_submissionId_idx" ON "SubmissionComment"("submissionId" ASC);

-- CreateIndex
CREATE INDEX "SubmissionComment_videoId_idx" ON "SubmissionComment"("videoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionDependency_submissionId_dependentSubmissionId_key" ON "SubmissionDependency"("submissionId" ASC, "dependentSubmissionId" ASC);

-- CreateIndex
CREATE INDEX "SubmissionPostingUrl_campaignId_platform_createdAt_idx" ON "SubmissionPostingUrl"("campaignId" ASC, "platform" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPostingUrl_id_key" ON "SubmissionPostingUrl"("id" ASC);

-- CreateIndex
CREATE INDEX "SubmissionPostingUrl_submissionId_idx" ON "SubmissionPostingUrl"("submissionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPostingUrl_submissionId_platform_postUrl_key" ON "SubmissionPostingUrl"("submissionId" ASC, "platform" ASC, "postUrl" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionType_type_key" ON "SubmissionType"("type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_id_key" ON "Subscription"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionId_key" ON "Subscription"("subscriptionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionHistory_id_key" ON "SubscriptionHistory"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupBrand_id_key" ON "SupBrand"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupBrand_registration_number_key" ON "SupBrand"("registration_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupSupBrand_id_key" ON "SupSupBrand"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupSupBrand_registration_number_key" ON "SupSupBrand"("registration_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_key" ON "Task"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_id_key" ON "TaskAssignee"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Thread_campaignId_key" ON "Thread"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Thread_id_key" ON "Thread"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Thread_latestMessageId_key" ON "Thread"("latestMessageId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokUser_creatorId_key" ON "TiktokUser"("creatorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokUser_id_key" ON "TiktokUser"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokVideo_id_key" ON "TiktokVideo"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokVideo_video_id_key" ON "TiktokVideo"("video_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TimelineDefault_id_key" ON "TimelineDefault"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TimelineDefault_timelineTypeDefaultId_key" ON "TimelineDefault"("timelineTypeDefaultId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TimelineTypeDefault_id_key" ON "TimelineTypeDefault"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TimelineTypeDefault_name_key" ON "TimelineTypeDefault"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UnreadMessage_userId_threadId_messageId_key" ON "UnreadMessage"("userId" ASC, "threadId" ASC, "messageId" ASC);

-- CreateIndex
CREATE INDEX "UploadSession_status_expiresAt_idx" ON "UploadSession"("status" ASC, "expiresAt" ASC);

-- CreateIndex
CREATE INDEX "UploadSession_userId_status_idx" ON "UploadSession"("userId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_videoId_key" ON "UploadSession"("videoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_appleId_key" ON "User"("appleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationId_key" ON "User"("emailVerificationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_id_key" ON "User"("id" ASC);

-- CreateIndex
CREATE INDEX "UserFlow_flow_step_idx" ON "UserFlow"("flow" ASC, "step" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserFlow_id_key" ON "UserFlow"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserFlow_userId_flow_step_sessionId_key" ON "UserFlow"("userId" ASC, "flow" ASC, "step" ASC, "sessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_id_key" ON "UserNotification"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_userId_notificationId_key" ON "UserNotification"("userId" ASC, "notificationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_id_key" ON "VerificationCode"("id" ASC);

-- CreateIndex
CREATE INDEX "VideoOfTheMonth_featured_order_idx" ON "VideoOfTheMonth"("featured" ASC, "order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VideoOfTheMonth_submissionId_key" ON "VideoOfTheMonth"("submissionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_id_key" ON "WhatsappMessage"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_messageId_key" ON "WhatsappMessage"("messageId" ASC);

-- CreateIndex
CREATE INDEX "_RolePermission_B_index" ON "_RolePermission"("B" ASC);

-- CreateIndex
CREATE INDEX "_UserThreads_B_index" ON "_UserThreads"("B" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_id_key" ON "ai_model"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_userId_key" ON "ai_model"("userId" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp-setting_id_key" ON "whatsapp-setting"("id" ASC);

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermissionModule" ADD CONSTRAINT "AdminPermissionModule_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermissionModule" ADD CONSTRAINT "AdminPermissionModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermissionModule" ADD CONSTRAINT "AdminPermissionModule_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementTemplate" ADD CONSTRAINT "AgreementTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequestCreator" ADD CONSTRAINT "ApprovalRequestCreator_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequestCreator" ADD CONSTRAINT "ApprovalRequestCreator_pitchId_fkey" FOREIGN KEY ("pitchId") REFERENCES "Pitch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMarkCampaign" ADD CONSTRAINT "BookMarkCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMarkCampaign" ADD CONSTRAINT "BookMarkCampaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMarkCreator" ADD CONSTRAINT "BookMarkCreator_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMarkCreator" ADD CONSTRAINT "BookMarkCreator_listId_fkey" FOREIGN KEY ("listId") REFERENCES "BookMarkCreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMarkCreator" ADD CONSTRAINT "BookMarkCreator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMarkCreatorList" ADD CONSTRAINT "BookMarkCreatorList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bugs" ADD CONSTRAINT "Bugs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_agreementTemplateId_fkey" FOREIGN KEY ("agreementTemplateId") REFERENCES "AgreementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdditionalDetails" ADD CONSTRAINT "CampaignAdditionalDetails_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBrief" ADD CONSTRAINT "CampaignBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignClient" ADD CONSTRAINT "CampaignClient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignClient" ADD CONSTRAINT "CampaignClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPCR" ADD CONSTRAINT "CampaignPCR_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRequirement" ADD CONSTRAINT "CampaignRequirement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSubmissionRequirement" ADD CONSTRAINT "CampaignSubmissionRequirement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSubmissionRequirement" ADD CONSTRAINT "CampaignSubmissionRequirement_submissionTypeId_fkey" FOREIGN KEY ("submissionTypeId") REFERENCES "SubmissionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTask" ADD CONSTRAINT "CampaignTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTask" ADD CONSTRAINT "CampaignTask_campaignTimelineId_fkey" FOREIGN KEY ("campaignTimelineId") REFERENCES "CampaignTimeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTaskAdmin" ADD CONSTRAINT "CampaignTaskAdmin_campaignTaskId_fkey" FOREIGN KEY ("campaignTaskId") REFERENCES "CampaignTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTaskAdmin" ADD CONSTRAINT "CampaignTaskAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTimeline" ADD CONSTRAINT "CampaignTimeline_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTimeline" ADD CONSTRAINT "CampaignTimeline_submissionTypeId_fkey" FOREIGN KEY ("submissionTypeId") REFERENCES "SubmissionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionHistory" ADD CONSTRAINT "CaptionHistory_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAccount" ADD CONSTRAINT "ChildAccount_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Columns" ADD CONSTRAINT "Columns_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentAgreement" ADD CONSTRAINT "CommentAgreement_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "SubmissionComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentAgreement" ADD CONSTRAINT "CommentAgreement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_creditTierId_fkey" FOREIGN KEY ("creditTierId") REFERENCES "CreditTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAgreement" ADD CONSTRAINT "CreatorAgreement_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "Admin"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAgreement" ADD CONSTRAINT "CreatorAgreement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAgreement" ADD CONSTRAINT "CreatorAgreement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryDetails" ADD CONSTRAINT "DeliveryDetails_logisticId_fkey" FOREIGN KEY ("logisticId") REFERENCES "Logistic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_deliveryDetailsId_fkey" FOREIGN KEY ("deliveryDetailsId") REFERENCES "DeliveryDetails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_submissionCommentId_fkey" FOREIGN KEY ("submissionCommentId") REFERENCES "SubmissionComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finance" ADD CONSTRAINT "Finance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightSnapshot" ADD CONSTRAINT "InsightSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramUser" ADD CONSTRAINT "InstagramUser_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramVideo" ADD CONSTRAINT "InstagramVideo_instagramUserId_fkey" FOREIGN KEY ("instagramUserId") REFERENCES "InstagramUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Creator"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic" ADD CONSTRAINT "Logistic_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic" ADD CONSTRAINT "Logistic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic" ADD CONSTRAINT "Logistic_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticIssue" ADD CONSTRAINT "LogisticIssue_logisticId_fkey" FOREIGN KEY ("logisticId") REFERENCES "Logistic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticIssue" ADD CONSTRAINT "LogisticIssue_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualCreatorEntry" ADD CONSTRAINT "ManualCreatorEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaKit" ADD CONSTRAINT "MediaKit_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pitchId_fkey" FOREIGN KEY ("pitchId") REFERENCES "Pitch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpsFeedback" ADD CONSTRAINT "NpsFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentForm" ADD CONSTRAINT "PaymentForm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pic" ADD CONSTRAINT "Pic_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pic" ADD CONSTRAINT "Pic_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_acceptedInviteByCreatorId_fkey" FOREIGN KEY ("acceptedInviteByCreatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_adminCommentedBy_fkey" FOREIGN KEY ("adminCommentedBy") REFERENCES "Admin"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "Admin"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_approvedByClientId_fkey" FOREIGN KEY ("approvedByClientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_maybeByClientId_fkey" FOREIGN KEY ("maybeByClientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_rejectedByAdminId_fkey" FOREIGN KEY ("rejectedByAdminId") REFERENCES "Admin"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_rejectedByClientId_fkey" FOREIGN KEY ("rejectedByClientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicAccess" ADD CONSTRAINT "PublicAccess_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicFeedback" ADD CONSTRAINT "PublicFeedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawFootage" ADD CONSTRAINT "RawFootage_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawFootage" ADD CONSTRAINT "RawFootage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawFootage" ADD CONSTRAINT "RawFootage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawFootage" ADD CONSTRAINT "RawFootage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationConfiguration" ADD CONSTRAINT "ReservationConfiguration_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDetails" ADD CONSTRAINT "ReservationDetails_logisticId_fkey" FOREIGN KEY ("logisticId") REFERENCES "Logistic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationSlot" ADD CONSTRAINT "ReservationSlot_reservationDetailsId_fkey" FOREIGN KEY ("reservationDetailsId") REFERENCES "ReservationDetails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResetPasswordToken" ADD CONSTRAINT "ResetPasswordToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenMessage" ADD CONSTRAINT "SeenMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenMessage" ADD CONSTRAINT "SeenMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortListedCreator" ADD CONSTRAINT "ShortListedCreator_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortListedCreator" ADD CONSTRAINT "ShortListedCreator_creditTierId_fkey" FOREIGN KEY ("creditTierId") REFERENCES "CreditTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortListedCreator" ADD CONSTRAINT "ShortListedCreator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreVisitDetails" ADD CONSTRAINT "StoreVisitDetails_logisticId_fkey" FOREIGN KEY ("logisticId") REFERENCES "Logistic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "Admin"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submissionTypeId_fkey" FOREIGN KEY ("submissionTypeId") REFERENCES "SubmissionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submittedByAdminId_fkey" FOREIGN KEY ("submittedByAdminId") REFERENCES "Admin"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionComment" ADD CONSTRAINT "SubmissionComment_forwardedByUserId_fkey" FOREIGN KEY ("forwardedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionComment" ADD CONSTRAINT "SubmissionComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SubmissionComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionComment" ADD CONSTRAINT "SubmissionComment_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionComment" ADD CONSTRAINT "SubmissionComment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionComment" ADD CONSTRAINT "SubmissionComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionComment" ADD CONSTRAINT "SubmissionComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionDependency" ADD CONSTRAINT "SubmissionDependency_dependentSubmissionId_fkey" FOREIGN KEY ("dependentSubmissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionDependency" ADD CONSTRAINT "SubmissionDependency_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPostingUrl" ADD CONSTRAINT "SubmissionPostingUrl_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPostingUrl" ADD CONSTRAINT "SubmissionPostingUrl_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customPackageId_fkey" FOREIGN KEY ("customPackageId") REFERENCES "CustomPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionHistory" ADD CONSTRAINT "SubscriptionHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionHistory" ADD CONSTRAINT "SubscriptionHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupBrand" ADD CONSTRAINT "SupBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupSupBrand" ADD CONSTRAINT "SupSupBrand_supBrandId_fkey" FOREIGN KEY ("supBrandId") REFERENCES "SupBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_latestMessageId_fkey" FOREIGN KEY ("latestMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TiktokUser" ADD CONSTRAINT "TiktokUser_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TiktokVideo" ADD CONSTRAINT "TiktokVideo_tiktokUserId_fkey" FOREIGN KEY ("tiktokUserId") REFERENCES "TiktokUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineDefault" ADD CONSTRAINT "TimelineDefault_timelineTypeDefaultId_fkey" FOREIGN KEY ("timelineTypeDefaultId") REFERENCES "TimelineTypeDefault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnreadMessage" ADD CONSTRAINT "UnreadMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnreadMessage" ADD CONSTRAINT "UnreadMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnreadMessage" ADD CONSTRAINT "UnreadMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_emailVerificationId_fkey" FOREIGN KEY ("emailVerificationId") REFERENCES "EmailVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFlow" ADD CONSTRAINT "UserFlow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserThread" ADD CONSTRAINT "UserThread_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserThread" ADD CONSTRAINT "UserThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_resubmittedFromId_fkey" FOREIGN KEY ("resubmittedFromId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoOfTheMonth" ADD CONSTRAINT "VideoOfTheMonth_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermission" ADD CONSTRAINT "_RolePermission_A_fkey" FOREIGN KEY ("A") REFERENCES "Permisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermission" ADD CONSTRAINT "_RolePermission_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserThreads" ADD CONSTRAINT "_UserThreads_A_fkey" FOREIGN KEY ("A") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserThreads" ADD CONSTRAINT "_UserThreads_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

