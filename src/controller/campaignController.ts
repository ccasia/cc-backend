import { Request, Response } from 'express';
import {
  Admin,
  CampaignAdmin,
  CampaignBrief,
  CampaignRequirement,
  CampaignStatus,
  CampaignTimeline,
  Company,
  Creator,
  Entity,
  Interest,
  LogisticStatus,
  PaymentForm,
  Pitch,
  PrismaClient,
  ShortListedCreator,
  Submission,
  SubmissionType,
  User,
  TimelineStatus,
  TiktokUser,
  InstagramUser,
  LogisticType,
  ReservationMode,
} from '@prisma/client';

import amqplib from 'amqplib';

import {
  deleteContent,
  uploadAgreementForm,
  uploadAttachments,
  uploadCompanyLogo,
  uploadImage,
  uploadPitchVideo,
} from '@configs/cloudStorage.config';
import dayjs from 'dayjs';
import { logChange, logAdminChange, uploadCampaignAssets, createNewSpreadSheetAsync } from '@services/campaignServices';
import { saveNotification } from '@controllers/notificationController';
import { clients, io } from '../server';
import fs from 'fs';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import path from 'path';
import { compress } from '@helper/compression';
import { agreementInput } from '@helper/agreementInput';
import { pdfConverter } from '@helper/pdfConverter';
import {
  notificationPendingAgreement,
  notificationPitch,
  notificationSignature,
  notificationCampaignLive,
  notificationAdminAssign,
  notificationMaintenance,
  notificationLogisticTracking,
  notificationLogisticDelivery,
  notificationPitchForClientReview,
} from '@helper/notification';
import { deliveryConfirmation, shortlisted, tracking } from '@configs/nodemailer.config';
import { createNewSpreadSheet, upsertSheetAndWriteRows } from '@services/google_sheets/sheets';
import { getRemainingCredits } from '@services/companyService';
import { handleGuestForShortListing } from '@services/shortlistService';
import getCountry from '@utils/getCountry';
// import { applyCreditCampiagn } from '@services/packageService';
import { sendShortlistEmailToClients, ShortlistedCreatorInput } from '@services/notificationService';
import { calculateAverageMetrics } from '@utils/averagingMetrics';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();

interface image {
  path: string;
  preview: string;
}

interface timeline {
  id: string;
  openForPitch: number;
  shortlistCreator: number;
  firstDraft: number;
  finalDraft: number;
  feedBackFirstDraft: number;
  feedBackFinalDraft: number;
  filterPitch: number;
  agreementSign: number;
  qc: number;
  posting: number;
}

interface RawFootage {
  url: string;
}

interface Photo {
  url: string;
}

interface Campaign {
  campaignId?: string;
  campaignInterests: string[];
  campaignIndustries: string;
  campaignBrand: {
    id: string;
  };
  hasBrand: Boolean;
  client: Company;
  campaignStartDate: Date;
  campaignEndDate: Date;
  postingStartDate: Date;
  postingEndDate: Date;
  campaignTitle: string;
  campaignObjectives: string;
  campaignDo: any;
  campaignDont: any;
  campaignDescription: string;
  audienceAge: string[];
  audienceGender: string[];
  audienceLocation: string[];
  audienceLanguage: string[];
  audienceCreatorPersona: string[];
  audienceUserPersona: string;
  campaignManager: [];
  campaignStage: string;
  campaignImages: image[];
  agreementFrom: { id: string };
  defaultTimeline: timeline;
  status: string;
  adminId: string;
  timeline: any;
  adminTest: [];
  brandTone: string;
  // productName: string;
  socialMediaPlatform: string[];
  videoAngle: string[];
  campaignType: string;
  // agreementForm: { id: string };
  otherAttachments?: string[];
  referencesLinks?: string[];
  rawFootage: boolean;
  photos: boolean;
  crossPosting: boolean;
  ads: boolean;
  campaignCredits: number;
  country: string[];
  countries?: string[];
  logisticsType?: string;
  products?: { name: string }[];
  clientRemarks?: string;
  schedulingOption?: string;
  locations?: { name: string }[];
  availabilityRules?: {
    dates: string[];
    startTime: string;
    endTime: string;
    interval: number;
  }[];
  allowMultipleBookings?: boolean;
}

interface RequestQuery {
  status: string;
  page: number;
  limit: number;
  userId: string;
}

const MAPPING: Record<string, string> = {
  AGREEMENT_FORM: 'Agreement',
  FIRST_DRAFT: 'First Draft',
  FINAL_DRAFT: 'Final Draft',
  POSTING: 'Posting',
};

export const createCampaign = async (req: Request, res: Response) => {
  const {
    campaignId,
    campaignTitle,
    campaignBrand,
    hasBrand,
    client,
    campaignStartDate,
    campaignEndDate,
    postingStartDate,
    postingEndDate,
    campaignObjectives,
    socialMediaPlatform,
    videoAngle,
    campaignDescription,
    audienceGender,
    audienceAge,
    audienceLocation,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    campaignDo,
    campaignDont,
    campaignManager,
    campaignStage,
    campaignIndustries,
    timeline,
    brandTone,
    agreementFrom,
    referencesLinks,
    campaignType,
    rawFootage,
    photos,
    crossPosting,
    ads,
    campaignCredits,
    country,
    countries,
    logisticsType,
    products,
    clientRemarks,
    schedulingOption,
    locations,
    availabilityRules,
    allowMultipleBookings,
  }: Campaign = JSON.parse(req.body.data);

  // Also read optional fields not in the Campaign interface
  const rawBody: any = (() => {
    try {
      return JSON.parse(req.body.data);
    } catch {
      return {};
    }
  })();

  const requestedOrigin = rawBody?.origin as 'ADMIN' | 'CLIENT' | undefined;
  const clientManagers = Array.isArray(rawBody?.clientManagers) ? rawBody.clientManagers : [];
  const submissionVersion = rawBody?.submissionVersion as 'v4' | undefined;
  const isCreditTier = rawBody?.isCreditTier === true;

  try {
    const { images, attachments } = await uploadCampaignAssets(req.files);

    // Handle All processes
    const campaign = await prisma.$transaction(
      async (tx) => {
        const admins = await Promise.all(
          campaignManager.map(async (admin) => {
            return await tx.user.findUnique({
              where: {
                id: (admin as any).id as string,
              },
              include: {
                admin: true,
                client: true, // Include client relation to identify client users
              },
            });
          }),
        );

        // Attach client managers (if provided) to campaignAdmin as well
        const clientManagerUsers = await Promise.all(
          clientManagers.map(async (cm: any) => {
            // Accept either {id} or email/name strings; try id first
            if (cm?.id) {
              return tx.user.findUnique({ where: { id: cm.id } });
            }
            // Try by email
            if (typeof cm === 'string' && cm.includes('@')) {
              return tx.user.findUnique({ where: { email: cm } });
            }
            return null;
          }),
        );

        const existingClient = await tx.company.findUnique({
          where: { id: client.id },
          include: { subscriptions: { where: { status: 'ACTIVE' } } },
        });

        if (!existingClient) throw new Error('Company not found');

        const availableCredits = await getRemainingCredits(existingClient.id);

        // Ensure availableCredits is a valid number
        if (availableCredits === null || typeof availableCredits !== 'number') {
          throw new Error('Unable to retrieve available credits for the client');
        }

        // Check if campaignCredits exceed availableCredits
        if (campaignCredits > availableCredits) {
          throw new Error('Not enough credits to create the campaign');
        }

        // Create Campaign
        // Normalize dates for campaign brief
        const normalizedStartDate = campaignStartDate ? dayjs(campaignStartDate).toDate() : new Date();
        const normalizedEndDate = campaignEndDate ? dayjs(campaignEndDate).toDate() : normalizedStartDate;
        const normalizedPostingStartDate = postingStartDate ? dayjs(postingStartDate).toDate() : normalizedStartDate;
        const normalizedPostingEndDate = postingEndDate ? dayjs(postingEndDate).toDate() : normalizedStartDate;

        let productsToCreate: any[] = [];
        if (logisticsType === 'PRODUCT_DELIVERY' && Array.isArray(products)) {
          productsToCreate = products
            .filter((product: any) => product.name && product.name.trim() !== '')
            .map((product: any) => ({ productName: product.name }));
        }

        let reservationConfigCreate = undefined;
        if (logisticsType === 'RESERVATION') {
          const mode: ReservationMode = schedulingOption === 'auto' ? 'AUTO_SCHEDULE' : 'MANUAL_CONFIRMATION';

          const locationNames = Array.isArray(locations)
            ? locations.filter((loc: any) => loc.name && loc.name.trim() !== '')
            : [];

          reservationConfigCreate = {
            create: {
              mode: mode,
              locations: locationNames as any,
              availabilityRules: (availabilityRules || []) as any,
              clientRemarks: clientRemarks || null,
              allowMultipleBookings: allowMultipleBookings || false,
            },
          };
        }

        let finalizedCountries: string[] = [];
        if (Array.isArray(countries) && countries.length > 0) {
          finalizedCountries = countries;
        } else if (Array.isArray(country) && country.length > 0) {
          finalizedCountries = country;
        } else if (typeof country === 'string' && country) {
          finalizedCountries = [country];
        }

        const campaign = await tx.campaign.create({
          data: {
            campaignId: campaignId,
            name: campaignTitle,
            campaignType: campaignType,
            description: campaignDescription,
            status: campaignStage as CampaignStatus,
            origin: requestedOrigin === 'CLIENT' ? 'CLIENT' : 'ADMIN',
            submissionVersion: submissionVersion || undefined, // Set v4 if client user is added as manager
            isCreditTier: isCreditTier,
            brandTone: brandTone,
            rawFootage: rawFootage || false,
            ads: ads || false,
            photos: photos || false,
            crossPosting: crossPosting || false,
            logisticsType: logisticsType && logisticsType !== '' ? (logisticsType as LogisticType) : null,
            agreementTemplate: {
              connect: {
                id: agreementFrom.id,
              },
            },
            products: {
              create: productsToCreate,
            },
            reservationConfig: reservationConfigCreate,
            campaignBrief: {
              create: {
                title: campaignTitle,
                images: images,
                otherAttachments: attachments,
                referencesLinks: referencesLinks?.map((link: any) => link.value) || [],
                startDate: normalizedStartDate,
                endDate: normalizedEndDate,
                postingStartDate: normalizedPostingStartDate,
                postingEndDate: normalizedPostingEndDate,
                industries: campaignIndustries,
                campaigns_do: campaignDo,
                campaigns_dont: campaignDont,
                videoAngle: videoAngle,
                socialMediaPlatform: socialMediaPlatform,
                objectives: clientRemarks
                  ? `${campaignObjectives}\n\n[Logistic Remarks]: ${clientRemarks}`
                  : campaignObjectives,
              },
            },
            campaignRequirement: {
              create: {
                gender: audienceGender,
                age: audienceAge,
                geoLocation: audienceLocation,
                language: audienceLanguage,
                creator_persona: audienceCreatorPersona,
                user_persona: audienceUserPersona,
                country: Array.isArray(countries) && countries.length > 0 ? countries[0] : (Array.isArray(country) && country.length > 0 ? country[0] : (typeof countries === 'string' ? countries : (typeof country === 'string' ? country : ''))), // Legacy single country
                countries: Array.isArray(countries) ? countries : (Array.isArray(country) ? country : (typeof countries === 'string' ? [countries] : (typeof country === 'string' ? [country] : []))), // Ensure array for multiple countries field
              },
            },
            campaignCredits,
            creditsPending: campaignCredits,
            creditsUtilized: 0,
            subscription: {
              connect: {
                id: existingClient.subscriptions[0].id,
              },
            },
          },
          include: {
            campaignBrief: true,
            products: true,
            reservationConfig: true,
          },
        });

        // Deduct credits from subscription
        await tx.subscription.update({
          where: {
            id: existingClient.subscriptions[0].id,
          },
          data: {
            creditsUsed: {
              increment: campaignCredits,
            },
          },
        });

        // Create Campaign Timeline using helper
        // For v4 campaigns, timelines are created based on campaign dates proportionally
        // For non-v4 campaigns, timelines are created from the frontend timeline array
        const { createCampaignTimelines } = require('../helper/campaignTimelineHelper');

        await createCampaignTimelines(tx, campaign.id, timeline, {
          submissionVersion: submissionVersion,
          campaignStartDate: normalizedStartDate,
          campaignEndDate: normalizedEndDate,
          postingStartDate: normalizedPostingStartDate,
          postingEndDate: normalizedPostingEndDate,
          campaignType: campaignType,
        });

        // Connect to brand
        if (campaignBrand) {
          // connect with brand
          await tx.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              brand: { connect: { id: campaignBrand.id } },
            },
          });
        } else {
          // connect with client
          await tx.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              company: { connect: { id: client.id } },
            },
          });
        }

        if (!campaign || !campaign.id) {
          throw new Error('Campaign creation failed or campaign ID is missing');
        }

        // Check if the user creating the campaign is a Client
        const userId = req.session.userid;

        if (userId) {
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            include: { admin: { include: { role: true } } },
          });

          // If the user is a Client, add them to campaignAdmin
          if (currentUser?.admin?.role?.name === 'Client') {
            await tx.campaignAdmin.create({
              data: {
                adminId: userId,
                campaignId: campaign.id,
              },
            });
          }
        }

        await tx.thread.create({
          data: {
            title: campaign.name,
            description: campaign.description,
            campaignId: campaign.id,
            photoURL: images[0],
            UserThread: {
              create: admins.map((admin: any) => ({
                userId: admin.id,
              })),
            },
          },
          include: {
            UserThread: true,
            campaign: true,
          },
        });

        // Add campaignManager and clientManagers to campaignAdmin
        const adminIdsToAdd = [
          ...admins.map((a: any) => a?.id).filter(Boolean),
          ...clientManagerUsers.map((u: any) => u?.id).filter(Boolean),
        ] as string[];
        for (const adminUserId of adminIdsToAdd) {
          const exists = await tx.campaignAdmin.findUnique({
            where: { adminId_campaignId: { adminId: adminUserId, campaignId: campaign.id } },
          });
          if (!exists) {
            await tx.campaignAdmin.create({ data: { adminId: adminUserId, campaignId: campaign.id } });
          }
        }

        await Promise.all(
          admins.map(async (admin: any) => {
            const existing = await tx.campaignAdmin.findUnique({
              where: {
                adminId_campaignId: {
                  adminId: admin?.id,
                  campaignId: campaign?.id,
                },
              },
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            });

            if (existing) {
              // Skip existing admin instead of aborting the whole request
              return null;
            }

            const createdAdminRel = await tx.campaignAdmin.create({
              data: {
                adminId: admin?.id,
                campaignId: campaign.id,
              },
              include: {
                admin: true,
              },
            });

            await tx.event.create({
              data: {
                start: dayjs(campaign?.campaignBrief?.startDate).format(),
                end: dayjs(campaign?.campaignBrief?.endDate).format(),
                title: campaign?.name,
                userId: createdAdminRel.admin.userId as string,
                allDay: false,
              },
            });

            const { title, message } = notificationAdminAssign(campaign.name);

            const data = await tx.notification.create({
              data: {
                title: title,
                message: message,
                entity: 'Status',
                campaign: {
                  connect: {
                    id: campaign.id,
                  },
                },
                userNotification: {
                  create: {
                    userId: admin.id,
                  },
                },
              },
              include: {
                userNotification: {
                  select: {
                    userId: true,
                  },
                },
              },
            });

            io.to(clients.get(admin.id)).emit('notification', data);
            return createdAdminRel;
          }),
        );

        logChange('Created the Campaign', campaign.id, req);

        // Get admin info for logging
        const admin = await tx.user.findUnique({
          where: { id: req.session.userid },
        });
        const adminName = admin?.name || 'Admin';
        const userRole = admin?.role || 'admin';

        // Log campaign activity for campaign creation
        const campaignActivityMessage = `Campaign Created`;
        await tx.campaignLog.create({
          data: {
            message: campaignActivityMessage,
            adminId: req.session.userid,
            campaignId: campaign.id,
          },
        });

        const adminId = req.session.userid;
        if (adminId) {
          const adminLogMessage = `Created campaign - "${campaign.name}" `;
          logAdminChange(adminLogMessage, adminId, req);
        }

        if (io) {
          io.emit('campaign');
        }

        // Add child accounts to the new campaign if it's a client-created campaign
        if (campaign.origin === 'CLIENT' && client) {
          try {
            const { addChildAccountsToCampaign } = await import('./childAccountController.js');
            await addChildAccountsToCampaign(client.id, campaign.id);
          } catch (error) {
            console.error('Error adding child accounts to campaign:', error);
            // Don't fail the campaign creation if child account integration fails
          }
        }

        // For v4 campaigns only: Add client users to both CampaignClient AND CampaignAdmin
        // This ensures backwards compatibility - clients can access via CampaignAdmin
        // and we track them separately in CampaignClient for future role management
        if (submissionVersion === 'v4' && client?.id) {
          try {
            const companyClients = await tx.client.findMany({
              where: { companyId: client.id },
              include: { user: true },
            });

            for (const companyClient of companyClients) {
              // Add to CampaignClient
              const existingCampaignClient = await tx.campaignClient.findUnique({
                where: {
                  clientId_campaignId: {
                    clientId: companyClient.id,
                    campaignId: campaign.id,
                  },
                },
              });

              if (!existingCampaignClient) {
                await tx.campaignClient.create({
                  data: {
                    clientId: companyClient.id,
                    campaignId: campaign.id,
                    role: 'owner',
                  },
                });
                console.log(`Added client ${companyClient.id} to CampaignClient for v4 campaign ${campaign.id}`);
              }

              // Also add to CampaignAdmin for backwards compatibility
              if (companyClient.userId) {
                const existingCampaignAdmin = await tx.campaignAdmin.findUnique({
                  where: {
                    adminId_campaignId: {
                      adminId: companyClient.userId,
                      campaignId: campaign.id,
                    },
                  },
                });

                if (!existingCampaignAdmin) {
                  await tx.campaignAdmin.create({
                    data: {
                      adminId: companyClient.userId,
                      campaignId: campaign.id,
                    },
                  });
                  console.log(
                    `Added client user ${companyClient.userId} to CampaignAdmin for v4 campaign ${campaign.id}`,
                  );
                }
              }
            }
          } catch (error) {
            console.error('Error adding clients to CampaignClient/CampaignAdmin:', error);
            // Don't fail the campaign creation if integration fails
          }
        }

        // For v4 campaigns: Also add any client users from campaignManager to CampaignClient
        if (submissionVersion === 'v4') {
          try {
            for (const user of admins) {
              if (user?.client?.id) {
                const existingCampaignClient = await tx.campaignClient.findUnique({
                  where: {
                    clientId_campaignId: {
                      clientId: user.client.id,
                      campaignId: campaign.id,
                    },
                  },
                });

                if (!existingCampaignClient) {
                  await tx.campaignClient.create({
                    data: {
                      clientId: user.client.id,
                      campaignId: campaign.id,
                      role: 'owner',
                    },
                  });
                  console.log(
                    `Added client user ${user.client.id} from campaignManager to CampaignClient for v4 campaign ${campaign.id}`,
                  );
                }
              }
            }
          } catch (error) {
            console.error('Error adding client users from campaignManager to CampaignClient:', error);
            // Don't fail the campaign creation if CampaignClient integration fails
          }
        }

        return campaign;
      },
      {
        timeout: 500000,
      },
    );

    createNewSpreadSheetAsync({ title: campaignTitle, campaignId: campaign.id });

    return res.status(200).json({ campaign, message: 'Campaign created successfully.' });
  } catch (error) {
    if (!res.headersSent) {
      return res.status(400).json(error?.message);
    }
    console.error('createCampaign error after response sent:', error);
  }
};

/**
 * Create Campaign V2 - Enhanced version with additional details support
 */
export const createCampaignV2 = async (req: Request, res: Response) => {
  const rawData = JSON.parse(req.body.data);
  const {
    // General info fields
    campaignId,
    campaignStage,
    campaignName,
    campaignDescription,
    brandAbout,
    campaignStartDate,
    campaignEndDate,
    productName,
    campaignIndustries,
    websiteLink,
    // Campaign objectives
    campaignObjectives,
    secondaryObjectives,
    boostContent,
    primaryKPI,
    performanceBaseline,
    // Target audience
    country,
    countries,
    audienceGender,
    audienceAge,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    geographicFocus,
    geographicFocusOthers,
    // Target audience secondary
    secondaryAudienceGender,
    secondaryAudienceAge,
    secondaryAudienceLanguage,
    secondaryAudienceCreatorPersona,
    secondaryAudienceUserPersona,
    secondaryCountry,
    // Logistics
    logisticsType,
    products,
    schedulingOption,
    locations,
    availabilityRules,
    allowMultipleBookings,
    clientRemarks,
    // Campaign management
    client,
    campaignBrand,
    campaignCredits,
    campaignManager,
    campaignType,
    rawFootage,
    photos,
    crossPosting,
    ads,
    agreementFrom,
    timeline,
    // Additional Details 1 fields
    socialMediaPlatform,
    contentFormat,
    postingStartDate,
    postingEndDate,
    mainMessage,
    keyPoints,
    toneAndStyle,
    referenceContent,
    // Additional Details 2 fields
    hashtagsToUse,
    mentionsTagsRequired,
    creatorCompensation,
    ctaDesiredAction,
    ctaLinkUrl,
    ctaPromoCode,
    ctaLinkInBioRequirements,
    specialNotesInstructions,
    needAds,
    // Submission version - 'v2' by default, 'v4' for client-managed campaigns
    submissionVersion,
  } = rawData;

  const clientManagers = Array.isArray(rawData?.clientManagers) ? rawData.clientManagers : [];
  const isCreditTier = rawData?.isCreditTier === true;

  try {
    const { images } = await uploadCampaignAssets(req.files);

    const campaign = await prisma.$transaction(
      async (tx) => {
        const admins = await Promise.all(
          (campaignManager || []).map(async (admin: any) => {
            return await tx.user.findUnique({
              where: { id: admin?.id as string },
              include: { admin: true, client: true },
            });
          }),
        );

        const clientManagerUsers = await Promise.all(
          clientManagers.map(async (cm: any) => {
            if (cm?.id) {
              return tx.user.findUnique({ where: { id: cm.id } });
            }
            if (typeof cm === 'string' && cm.includes('@')) {
              return tx.user.findUnique({ where: { email: cm } });
            }
            return null;
          }),
        );

        const existingClient = await tx.company.findUnique({
          where: { id: client.id },
          include: { subscriptions: { where: { status: 'ACTIVE' } } },
        });

        if (!existingClient) throw new Error('Company not found');

        const availableCredits = await getRemainingCredits(existingClient.id);

        if (availableCredits === null || typeof availableCredits !== 'number') {
          throw new Error('Unable to retrieve available credits for the client');
        }

        if (campaignCredits > availableCredits) {
          throw new Error('Not enough credits to create the campaign');
        }

        // Process uploaded images
        const publicURL: string[] = [];
        if (req.files && (req.files as any).campaignImages) {
          const images = Array.isArray((req.files as any).campaignImages)
            ? (req.files as any).campaignImages
            : [(req.files as any).campaignImages];

          for (const image of images) {
            // Use your existing image upload function
            const url = await uploadCompanyLogo(image.tempFilePath, image.name);
            publicURL.push(url);
          }
        }

        // Normalize dates
        const normalizedStartDate = campaignStartDate ? dayjs(campaignStartDate).toDate() : new Date();
        const normalizedEndDate = campaignEndDate ? dayjs(campaignEndDate).toDate() : normalizedStartDate;
        const normalizedPostingStartDate = postingStartDate ? dayjs(postingStartDate).toDate() : normalizedStartDate;
        const normalizedPostingEndDate = postingEndDate ? dayjs(postingEndDate).toDate() : normalizedStartDate;

        // Handle products for delivery logistics
        let productsToCreate: any[] = [];
        if (logisticsType === 'PRODUCT_DELIVERY' && Array.isArray(products)) {
          productsToCreate = products
            .filter((product: any) => product.name && product.name.trim() !== '')
            .map((product: any) => ({ productName: product.name }));
        }

        // Handle reservation config
        let reservationConfigCreate = undefined;
        if (logisticsType === 'RESERVATION') {
          const mode: ReservationMode = schedulingOption === 'auto' ? 'AUTO_SCHEDULE' : 'MANUAL_CONFIRMATION';
          const locationNames = Array.isArray(locations)
            ? locations.filter((loc: any) => loc.name && loc.name.trim() !== '')
            : [];
          reservationConfigCreate = {
            create: {
              mode: mode,
              locations: locationNames as any,
              availabilityRules: (availabilityRules || []) as any,
              clientRemarks: clientRemarks || null,
              allowMultipleBookings: allowMultipleBookings || false,
            },
          };
        }

        // Finalize countries - combine country, secondaryCountry, and geographicFocusOthers
        let finalizedCountries: string[] = [];
        if (typeof country === 'string' && country) {
          finalizedCountries.push(country);
        } else if (Array.isArray(country) && country.length > 0) {
          finalizedCountries.push(...country);
        }
        if (typeof secondaryCountry === 'string' && secondaryCountry) {
          finalizedCountries.push(secondaryCountry);
        } else if (Array.isArray(secondaryCountry) && secondaryCountry.length > 0) {
          finalizedCountries.push(...secondaryCountry);
        }
        if (typeof geographicFocusOthers === 'string' && geographicFocusOthers) {
          finalizedCountries.push(geographicFocusOthers);
        } else if (Array.isArray(geographicFocusOthers) && geographicFocusOthers.length > 0) {
          finalizedCountries.push(...geographicFocusOthers);
        }
        // Remove duplicates
        finalizedCountries = [...new Set(finalizedCountries)];

        // Create the campaign with submissionVersion from form data (v2 default, v4 for client-managed)
        const campaign = await tx.campaign.create({
          data: {
            campaignId: campaignId,
            name: campaignName,
            campaignType: campaignType,
            description: campaignDescription,
            status: campaignStage as CampaignStatus,
            brandAbout: brandAbout || '',
            productName: productName || '',
            websiteLink: websiteLink || '',
            origin: 'ADMIN',
            submissionVersion: submissionVersion || 'v2',
            rawFootage: rawFootage || false,
            ads: ads || false,
            photos: photos || false,
            crossPosting: crossPosting || false,
            isCreditTier: isCreditTier,
            logisticsType: logisticsType && logisticsType !== '' ? (logisticsType as LogisticType) : null,
            agreementTemplate: {
              connect: { id: agreementFrom.id },
            },
            products: {
              create: productsToCreate,
            },
            reservationConfig: reservationConfigCreate,
            campaignBrief: {
              create: {
                title: campaignName,
                objectives: campaignObjectives || '',
                secondaryObjectives: Array.isArray(secondaryObjectives) ? secondaryObjectives : [],
                boostContent: boostContent || '',
                primaryKPI: primaryKPI || '',
                performanceBaseline: performanceBaseline || '',
                images: publicURL,
                startDate: campaignStartDate ? new Date(campaignStartDate) : new Date(),
                endDate: campaignEndDate ? new Date(campaignEndDate) : new Date(),
                postingStartDate: postingStartDate ? new Date(postingStartDate) : null,
                postingEndDate: postingEndDate ? new Date(postingEndDate) : null,
                industries: campaignIndustries ? campaignIndustries : [],
                socialMediaPlatform: Array.isArray(socialMediaPlatform) ? socialMediaPlatform : [],
              },
            },
            campaignRequirement: {
            create: {
              // Primary Audience
              gender: audienceGender || [],
              age: audienceAge || [],
              language: audienceLanguage || [],
              creator_persona: audienceCreatorPersona || [],
              user_persona: audienceUserPersona || '',
              country: finalizedCountries[0] || '',
              countries: finalizedCountries, 
              // Secondary Audience
              secondary_gender: secondaryAudienceGender || [],
              secondary_age: secondaryAudienceAge || [],
              secondary_language: secondaryAudienceLanguage || [],
              secondary_creator_persona: secondaryAudienceCreatorPersona || [],
              secondary_user_persona: secondaryAudienceUserPersona || '',
              secondary_country: secondaryCountry || '',
              geographic_focus: geographicFocus || '',
              geographicFocusOthers: geographicFocusOthers || '',
            },
            },
            campaignCredits,
            creditsPending: campaignCredits,
            creditsUtilized: 0,
            subscription: {
              connect: { id: existingClient.subscriptions[0].id },
            },
          },
          include: {
            campaignBrief: true,
            products: true,
            reservationConfig: true,
            campaignAdditionalDetails: true,
          },
        });

        // Process brand guidelines PDF/image upload (support multiple)
        let brandGuidelinesUrls: string[] = [];
        if (req.files && (req.files as any).brandGuidelines) {
          const brandGuidelinesFiles = Array.isArray((req.files as any).brandGuidelines)
            ? (req.files as any).brandGuidelines
            : [(req.files as any).brandGuidelines];
          for (const file of brandGuidelinesFiles) {
            if (file && file.tempFilePath && file.name) {
              const url = await uploadAttachments({
                tempFilePath: file.tempFilePath,
                fileName: file.name,
                folderName: 'brandGuidelines',
              });
              brandGuidelinesUrls.push(url);
            }
          }
        }

        // Process product image 1 upload
        let productImage1Url: string | null = null;
        if (req.files && (req.files as any).productImage1) {
          const productImage1Files = Array.isArray((req.files as any).productImage1)
            ? (req.files as any).productImage1
            : [(req.files as any).productImage1];
          if (productImage1Files.length > 0) {
            productImage1Url = await uploadCompanyLogo(productImage1Files[0].tempFilePath, productImage1Files[0].name);
          }
        }

        // Process product image 2 upload
        let productImage2Url: string | null = null;
        if (req.files && (req.files as any).productImage2) {
          const productImage2Files = Array.isArray((req.files as any).productImage2)
            ? (req.files as any).productImage2
            : [(req.files as any).productImage2];
          if (productImage2Files.length > 0) {
            productImage2Url = await uploadCompanyLogo(productImage2Files[0].tempFilePath, productImage2Files[0].name);
          }
        }

        // Create CampaignAdditionalDetails if any additional detail fields are provided
        const hasAdditionalDetails =
          (contentFormat && contentFormat.length > 0) ||
          mainMessage ||
          keyPoints ||
          toneAndStyle ||
          brandGuidelinesUrls ||
          referenceContent ||
          productImage1Url ||
          productImage2Url ||
          hashtagsToUse ||
          mentionsTagsRequired ||
          creatorCompensation ||
          ctaDesiredAction ||
          ctaLinkUrl ||
          ctaPromoCode ||
          ctaLinkInBioRequirements ||
          specialNotesInstructions ||
          needAds;

        if (hasAdditionalDetails) {
          await tx.campaignAdditionalDetails.create({
            data: {
              campaignId: campaign.id,
              contentFormat: Array.isArray(contentFormat) ? contentFormat : [],
              mainMessage: mainMessage || null,
              keyPoints: keyPoints || null,
              toneAndStyle: toneAndStyle || null,
              brandGuidelinesUrl: brandGuidelinesUrls.length === 0 ? null : (brandGuidelinesUrls.length === 1 ? brandGuidelinesUrls[0] : brandGuidelinesUrls.join(',')),
              referenceContent: referenceContent || null,
              productImage1Url: productImage1Url,
              productImage2Url: productImage2Url,
              // Additional Details 2 fields
              hashtagsToUse: hashtagsToUse || null,
              mentionsTagsRequired: mentionsTagsRequired || null,
              creatorCompensation: creatorCompensation || null,
              ctaDesiredAction: ctaDesiredAction || null,
              ctaLinkUrl: ctaLinkUrl || null,
              ctaPromoCode: ctaPromoCode || null,
              ctaLinkInBioRequirements: ctaLinkInBioRequirements || null,
              specialNotesInstructions: specialNotesInstructions || null,
              needAds: needAds || null,
            },
          });
        }

        // Deduct credits from subscription
        await tx.subscription.update({
          where: { id: existingClient.subscriptions[0].id },
          data: { creditsUsed: { increment: campaignCredits } },
        });

        // Create Campaign Timeline
        // For v4 campaigns: uses proportional date calculation based on campaign dates
        // For v2 campaigns: uses the timeline array from frontend with date validation
        const { createCampaignTimelines } = require('../helper/campaignTimelineHelper');
        await createCampaignTimelines(tx, campaign.id, timeline, {
          submissionVersion: submissionVersion || 'v2',
          campaignStartDate: normalizedStartDate,
          campaignEndDate: normalizedEndDate,
          postingStartDate: normalizedPostingStartDate,
          postingEndDate: normalizedPostingEndDate,
          campaignType: campaignType,
        });

        // Connect to brand or company
        if (campaignBrand) {
          await tx.campaign.update({
            where: { id: campaign.id },
            data: { brand: { connect: { id: campaignBrand.id } } },
          });
        } else {
          await tx.campaign.update({
            where: { id: campaign.id },
            data: { company: { connect: { id: client.id } } },
          });
        }

        if (!campaign || !campaign.id) {
          throw new Error('Campaign creation failed or campaign ID is missing');
        }

        // Check if creating user is a Client
        const userId = req.session.userid;
        if (userId) {
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            include: { admin: { include: { role: true } } },
          });
          if (currentUser?.admin?.role?.name === 'Client') {
            await tx.campaignAdmin.create({
              data: { adminId: userId, campaignId: campaign.id },
            });
          }
        }

        // Create thread
        await tx.thread.create({
          data: {
            title: campaign.name,
            description: campaign.description,
            campaignId: campaign.id,
            photoURL: images[0],
            UserThread: {
              create: admins.filter(Boolean).map((admin: any) => ({ userId: admin.id })),
            },
          },
        });

        // Add campaignManager and clientManagers to campaignAdmin
        const adminIdsToAdd = [
          ...admins.map((a: any) => a?.id).filter(Boolean),
          ...clientManagerUsers.map((u: any) => u?.id).filter(Boolean),
        ] as string[];

        for (const adminUserId of adminIdsToAdd) {
          const exists = await tx.campaignAdmin.findUnique({
            where: { adminId_campaignId: { adminId: adminUserId, campaignId: campaign.id } },
          });
          if (!exists) {
            await tx.campaignAdmin.create({ data: { adminId: adminUserId, campaignId: campaign.id } });
          }
        }

        // Create events and notifications for admins
        await Promise.all(
          admins.filter(Boolean).map(async (admin: any) => {
            const existing = await tx.campaignAdmin.findUnique({
              where: { adminId_campaignId: { adminId: admin?.id, campaignId: campaign?.id } },
            });

            if (existing) return null;

            const createdAdminRel = await tx.campaignAdmin.create({
              data: { adminId: admin?.id, campaignId: campaign.id },
              include: { admin: true },
            });

            await tx.event.create({
              data: {
                start: dayjs(normalizedStartDate).format(),
                end: dayjs(normalizedEndDate).format(),
                title: campaign?.name,
                userId: createdAdminRel.admin.userId as string,
                allDay: false,
              },
            });

            const { title, message } = notificationAdminAssign(campaign.name);

            const data = await tx.notification.create({
              data: {
                title,
                message,
                entity: 'Status',
                campaign: { connect: { id: campaign.id } },
                userNotification: { create: { userId: admin.id } },
              },
              include: { userNotification: { select: { userId: true } } },
            });

            io.to(clients.get(admin.id)).emit('notification', data);
            return createdAdminRel;
          }),
        );

        logChange('Created the Campaign', campaign.id, req);

        // Log campaign activity
        await tx.campaignLog.create({
          data: {
            message: 'Campaign Created',
            adminId: req.session.userid,
            campaignId: campaign.id,
          },
        });

        const adminId = req.session.userid;
        if (adminId) {
          logAdminChange(`Created campaign - "${campaign.name}"`, adminId, req);
        }

        if (io) {
          io.emit('campaign');
        }

        // Add child accounts for client-created campaigns
        if (campaign.origin === 'CLIENT' && client) {
          try {
            const { addChildAccountsToCampaign } = await import('./childAccountController.js');
            await addChildAccountsToCampaign(client.id, campaign.id);
          } catch (error) {
            console.error('Error adding child accounts to campaign:', error);
          }
        }

        // Add client users to CampaignClient and CampaignAdmin
        if (client?.id) {
          try {
            const companyClients = await tx.client.findMany({
              where: { companyId: client.id },
              include: { user: true },
            });

            for (const companyClient of companyClients) {
              const existingCampaignClient = await tx.campaignClient.findUnique({
                where: { clientId_campaignId: { clientId: companyClient.id, campaignId: campaign.id } },
              });

              if (!existingCampaignClient) {
                await tx.campaignClient.create({
                  data: { clientId: companyClient.id, campaignId: campaign.id, role: 'owner' },
                });
              }

              if (companyClient.userId) {
                const existingCampaignAdmin = await tx.campaignAdmin.findUnique({
                  where: { adminId_campaignId: { adminId: companyClient.userId, campaignId: campaign.id } },
                });

                if (!existingCampaignAdmin) {
                  await tx.campaignAdmin.create({
                    data: { adminId: companyClient.userId, campaignId: campaign.id },
                  });
                }
              }
            }
          } catch (error) {
            console.error('Error adding clients to CampaignClient/CampaignAdmin:', error);
          }
        }

        // Add client users from campaignManager to CampaignClient
        try {
          for (const user of admins.filter(Boolean)) {
            if ((user as any)?.client?.id) {
              const existingCampaignClient = await tx.campaignClient.findUnique({
                where: { clientId_campaignId: { clientId: (user as any).client.id, campaignId: campaign.id } },
              });

              if (!existingCampaignClient) {
                await tx.campaignClient.create({
                  data: { clientId: (user as any).client.id, campaignId: campaign.id, role: 'owner' },
                });
              }
            }
          }
        } catch (error) {
          console.error('Error adding client users from campaignManager to CampaignClient:', error);
        }

        return campaign;
      },
      { timeout: 500000 },
    );

    createNewSpreadSheetAsync({ title: campaignName, campaignId: campaign.id });

    return res.status(200).json({ campaign, message: 'Campaign created successfully.' });
  } catch (error) {
    if (!res.headersSent) {
      return res.status(400).json(error?.message);
    }
    console.error('createCampaignV2 error after response sent:', error);
  }
};

async function syncCreatorsCampaignSheetInternal() {
  // Spreadsheet and sheet details from user request
  const spreadsheetId = '1E6Rcm-0VA5INObz7weqpcdaQ7pcSLej7guiq8mwfjKo';
  const sheetTitle = 'Campaign';

  // Group shortlisted creators by user to get first campaign date and count
  const grouped = await prisma.shortListedCreator.groupBy({
    by: ['userId'],
    _count: { _all: true },
    _min: { shortlisted_date: true },
  });

  if (!grouped?.length) {
    await upsertSheetAndWriteRows({
      spreadSheetId: spreadsheetId,
      sheetTitle,
      headerRow: [
        'Date of First Campaign',
        'Name',
        'Number of Campaigns',
        'Email',
        'Phone Number',
        'Instagram Handle',
        'TikTok Handle',
      ],
      rows: [],
    });
    return;
  }

  const userIds = grouped.map((g) => g.userId).filter((id): id is string => Boolean(id));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    include: {
      creator: true,
    },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  const rows: (string | number)[][] = grouped
    .map((g) => {
      if (!g.userId) return null;
      const u = userMap.get(g.userId);
      if (!u) return null;
      const date = g._min?.shortlisted_date ? dayjs(g._min.shortlisted_date as any).format('YYYY-MM-DD') : '';
      const name = u.name || '';
      const numCampaigns = (g as any)._count?._all || 0;
      const email = u.email || '';
      const phone = u.phoneNumber || '';
      const ig = (u as any)?.creator?.instagram || (u as any)?.creator?.instagramUser?.username || '';
      const tiktok = (u as any)?.creator?.tiktok || (u as any)?.creator?.tiktokUser?.username || '';
      return [date, name, numCampaigns, email, phone, ig, tiktok];
    })
    .filter(Boolean) as (string | number)[][];

  await upsertSheetAndWriteRows({
    spreadSheetId: spreadsheetId,
    sheetTitle,
    headerRow: [
      'Date of First Campaign',
      'Name',
      'Number of Campaigns',
      'Email',
      'Phone Number',
      'Instagram Handle',
      'TikTok Handle',
    ],
    rows,
  });
}

export const exportActiveCompletedToSheet = async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        brand: true,
        company: true,
      },
    });

    const active = campaigns.filter((c) => c.status === 'ACTIVE');
    const completed = campaigns.filter((c) => c.status === 'COMPLETED');

    const toRow = (c: any): (string | number)[] => [
      c.name || '',
      c.brand?.name || c.company?.name || '',
      c.campaignCredits || 0,
      c.creditsUtilized || 0,
      c.creditsPending || Math.max((c.campaignCredits || 0) - (c.creditsUtilized || 0), 0),
    ];

    const header = ['Campaign', 'Client Name', 'Campaign Credits', 'Credits Utilized', 'Credits Pending'];

    // Target spreadsheet provided by user
    const spreadsheetId = '1AtuEMQDR3pblQqBStBpsW_S19bUY-4rJcjyQ_BE-YZY';

    await upsertSheetAndWriteRows({
      spreadSheetId: spreadsheetId,
      sheetTitle: 'Active',
      headerRow: header,
      rows: active.map(toRow),
    });

    await upsertSheetAndWriteRows({
      spreadSheetId: spreadsheetId,
      sheetTitle: 'Completed',
      headerRow: header,
      rows: completed.map(toRow),
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.log(error);
    return res.status(500).json({ success: false, message: error?.message || 'Failed to export' });
  }
};

export const exportCreatorsCampaignSheet = async (_req: Request, res: Response) => {
  try {
    await syncCreatorsCampaignSheetInternal();
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.log(error);
    return res.status(500).json({ success: false, message: error?.message || 'Failed to export' });
  }
};

// Campaign Info for Admin
export const getAllCampaigns = async (req: Request, res: Response) => {
  const id = req.session.userid;

  console.log('TEST');

  try {
    let campaigns;

    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      select: {
        admin: {
          select: {
            mode: true,
            role: true,
          },
        },
        id: true,
      },
    });

    if (user?.admin?.mode === 'god' || user?.admin?.role?.name === 'CSL' || user?.admin?.mode === 'advanced') {
      campaigns = await prisma.campaign.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          agreementTemplate: true,
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: {
            include: { company: { include: { subscriptions: { include: { package: true, customPackage: true } } } } },
          },
          company: true,
          campaignTimeline: true,
          campaignBrief: true,
          campaignRequirement: true,
          campaignLogs: {
            include: {
              admin: true,
            },
          },
          campaignAdmin: {
            include: {
              admin: {
                include: {
                  role: true,
                  user: {
                    include: {
                      agreementTemplate: true,
                    },
                  },
                },
              },
            },
          },
          campaignSubmissionRequirement: true,
          pitch: {
            include: {
              user: {
                include: {
                  creator: {
                    include: {
                      interests: true,
                    },
                  },

                  paymentForm: true,
                },
              },
            },
          },
          shortlisted: {
            select: {
              user: {
                include: {
                  creator: true,
                },
              },
              userId: true,
            },
          },
          campaignTasks: {
            include: {
              campaignTaskAdmin: true,
            },
          },
          logistics: {
            include: {
              creator: true,
              reservationDetails: {
                select: {
                  outlet: true,
                  creatorRemarks: true,
                },
              },
            },
          },
          creatorAgreement: true,
        },
      });
    } else {
      campaigns = await prisma.campaign.findMany({
        where: {
          campaignAdmin: {
            some: {
              adminId: user?.id,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          agreementTemplate: true,
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: { include: { company: { include: { subscriptions: true } } } },
          company: true,
          campaignTimeline: true,
          campaignBrief: true,
          campaignRequirement: true,
          campaignLogs: {
            include: {
              admin: true,
            },
          },
          campaignAdmin: {
            include: {
              admin: {
                include: {
                  user: {
                    include: {
                      agreementTemplate: true,
                    },
                  },
                },
              },
            },
          },
          campaignSubmissionRequirement: true,
          pitch: {
            include: {
              user: {
                include: {
                  creator: {
                    include: {
                      interests: true,
                    },
                  },
                },
              },
            },
          },
          shortlisted: {
            select: {
              user: {
                include: {
                  creator: true,
                },
              },
              userId: true,
            },
          },
          campaignTasks: {
            include: {
              campaignTaskAdmin: true,
            },
          },
          logistics: {
            include: {
              reservationDetails: {
                select: {
                  outlet: true,
                  creatorRemarks: true,
                },
              },
            },
          },
          creatorAgreement: true,
        },
      });
    }

    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCampaignById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log(`Getting campaign by ID: ${id}`);
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: id,
      },
      include: {
        agreementTemplate: true,
        submission: {
          include: {
            submissionType: true,
            dependencies: true,
            dependentOn: true,
          },
        },
        brand: {
          include: {
            company: { include: { subscriptions: { include: { package: true, customPackage: true } }, pic: true } },
          },
        },
        company: {
          include: {
            pic: true,
            subscriptions: {
              include: {
                customPackage: true,
                package: true,
              },
            },
          },
        },
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignAdditionalDetails: true,
        campaignLogs: {
          include: {
            admin: true,
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                role: true,
                user: {
                  include: {
                    agreementTemplate: true,
                  },
                },
              },
            },
          },
        },
        campaignClients: {
          include: {
            client: {
              include: {
                user: true,
              },
            },
          },
        },
        campaignSubmissionRequirement: {
          include: {
            submissionType: {
              select: {
                type: true,
              },
            },
          },
        },
        pitch: {
          include: {
            user: {
              include: {
                creator: {
                  include: {
                    interests: true,
                  },
                },
              },
            },
          },
        },
        shortlisted: {
          select: {
            id: true,
            ugcVideos: true,
            userId: true,
            adminComments: true,
            isAgreementReady: true,
            creditPerVideo: true,
            creditTierId: true,
            creditTier: {
              select: {
                id: true,
                name: true,
                creditsPerVideo: true,
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                photoURL: true,
                status: true,
                creator: {
                  select: {
                    isGuest: true,
                  },
                },
                paymentForm: true,
              },
            },
          },
        },
        campaignTasks: {
          include: {
            campaignTaskAdmin: true,
          },
        },
        logistics: {
          include: {
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
        products: true,
        reservationConfig: true,

        creatorAgreement: true,
      },
    });

    console.log(`Campaign found:`, {
      id: campaign?.id,
      name: campaign?.name,
      origin: campaign?.origin,
      status: campaign?.status,
    });

    return res.status(200).json(campaign);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAllActiveCampaign = async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        shortlisted: true,
        submission: true,
        logistics: {
          include: {
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
      },
    });

    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAllCampaignsFinance = async (req: Request, res: Response) => {
  const { userid } = req.session;
  const user = await prisma.user.findUnique({
    where: {
      id: userid,
    },
  });

  // if (user?.role !== 'finance') {
  //   return res.status(401).json({ message: 'Unauthorized' });
  // }

  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignLogs: {
          include: {
            admin: true,
          },
        },
        campaignAdmin: true,
        campaignSubmissionRequirement: true,
        pitch: {
          include: {
            user: {
              include: {
                creator: {
                  include: {
                    // industries: true,
                    interests: true,
                  },
                },
              },
            },
          },
        },
        shortlisted: {
          select: {
            user: {
              include: {
                creator: true,
              },
            },
            userId: true,
          },
        },
        campaignTasks: {
          include: {
            campaignTaskAdmin: true,
          },
        },
      },
    });
    //console.log(campaigns);
    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const matchCampaignWithCreator = async (req: Request, res: Response) => {
  const { userid } = req.session;
  const { cursor, take = 10, search } = req.query;
  const campaignId = req.query?.campaignId as string;

  console.log('DISCOVER PAGE DEBUG');
  console.log('User ID:', userid);
  console.log('Query params:', { cursor, take, search, campaignId });
  console.log('Request IP:', req.ip);

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        creator: {
          include: {
            interests: true,
          },
        },
      },
    });

    if (!user) {
      console.log('❌ User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('✅ User found:', user.name, '| Role:', user.role);
    console.log('Creator interests count:', user.creator?.interests?.length || 0);

    // Get all ACTIVE campaigns
    console.log('📡 Fetching campaigns from database...');
    let campaigns = await prisma.campaign.findMany({
      take: Number(take),
      // ...(cursor && {
      //   skip: 1,
      //   cursor: {
      //     id: cursor as string,
      //   },
      // }),
      ...(campaignId
        ? {
            cursor: { id: campaignId }, // start after this ID
          }
        : {
            ...(cursor && {
              skip: 1,
              cursor: {
                id: campaignId ?? (cursor as string),
              },
            }),
          }),
      where: {
        AND: [
          { status: 'ACTIVE' },
          {
            ...(search && {
              name: {
                contains: search as string,
                mode: 'insensitive',
              },
            }),
          },
          // {
          //   campaignRequirement: {
          //     country: {
          //       equals: country,
          //       mode: 'insensitive',
          //     },
          //   },
          // },
        ],
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        bookMarkCampaign: true,
        shortlisted: true,
        logistics: {
          include: {
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
        campaignLogs: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const originalFetchedCount = campaigns.length;
    console.log('Initial campaigns fetched from DB:', originalFetchedCount);

    if (campaigns?.length === 0) {
      console.log('No campaigns found in database');
      const data = {
        data: {
          campaigns: [],
        },
        metaData: {
          lastCursor: null,
          hasNextPage: false,
        },
      };

      return res.status(200).json(data);
    }

    console.log('Campaign IDs fetched:', campaigns.map(c => c.id).join(', '));
    console.log('Campaign names:', campaigns.map(c => c.name).join(', '));

    const beforeFilterCount = campaigns.length;

    campaigns = campaigns.filter((campaign) => {
      return campaign.status === 'ACTIVE';
    });

    console.log('✅ After ACTIVE status filter:', campaigns.length, '(removed:', beforeFilterCount - campaigns.length, ')');

    const country = await getCountry(req.ip as string);
    console.log('🌍 Detected country:', country);
    console.log('🔧 Environment:', process.env.NODE_ENV);

    const beforeCountryFilter = campaigns.length;

    if (process.env.NODE_ENV !== 'development') {
      campaigns = campaigns.filter((campaign) => {
        if (!campaign.campaignRequirement?.country) {
          console.log(`Campaign "${campaign.name}" has NO country requirement - INCLUDED`);
          return campaign;
        }

        const hasMatchingCountry = campaign.campaignRequirement.countries.some((a) => a.toLowerCase() === country?.toLowerCase());
        console.log(`Campaign "${campaign.name}" | Required countries: [${campaign.campaignRequirement.countries.join(', ')}] | Match: ${hasMatchingCountry ? '✅' : '❌'}`);
        return hasMatchingCountry;
        // return campaign.campaignRequirement.country.toLocaleLowerCase() === country?.toLowerCase();
      });
      console.log('✅ After country filter:', campaigns.length, '(removed:', beforeCountryFilter - campaigns.length, ')');
    } else {
      console.log('⚠️ Development mode - SKIPPING country filter');
    }

    const calculateInterestMatchingPercentage = (creatorInterests: Interest[], creatorPerona: []) => {
      const totalInterests = creatorPerona?.length || 0;

      if (totalInterests === 0) {
        return 0; // Return 0% if no persona interests defined
      }

      const matchingInterests =
        creatorInterests?.filter((interest) => creatorPerona.includes(interest?.name?.toLowerCase() as never)).length ||
        0;

      return (matchingInterests / totalInterests) * 100;
    };

    const calculateRequirementMatchingPercentage = (creator: Creator, campaignRequirements: CampaignRequirement) => {
      let matches = 0;
      let totalCriteria = 0;

      function isAgeInRange(age: any, ranges: any) {
        for (const range of ranges) {
          const [min, max] = range.split('-').map(Number);
          if (age >= min && age <= max) {
            return true;
          }
        }
        return false;
      }

      // Age
      const creatorAge = dayjs().diff(dayjs(creator.birthDate), 'year');
      if (campaignRequirements?.age) {
        totalCriteria++;
        if (isAgeInRange(creatorAge, campaignRequirements.age)) {
          matches++;
        }
      }

      // Gender
      const creatorGender =
        creator.pronounce === 'he/him' ? 'male' : creator.pronounce === 'she/her' ? 'female' : 'nonbinary';
      if (campaignRequirements?.gender) {
        totalCriteria++;
        if (campaignRequirements.gender.includes(creatorGender)) {
          matches++;
        }
      }

      // Language
      const creatorLang: any = creator.languages;
      if (campaignRequirements?.language.length) {
        totalCriteria++;
        if (campaignRequirements.language.map((item: any) => creatorLang.includes(item))) {
          matches++;
        }
      }

      return totalCriteria === 0 ? 0 : (matches / totalCriteria) * 100;
    };

    const calculateOverallMatchingPercentage = (
      interestMatch: number,
      requirementMatch: number,
      interestWeight = 0.5,
      requirementWeight = 0.5,
    ) => {
      return interestMatch * interestWeight + requirementMatch * requirementWeight;
    };

    console.log('🎯 Calculating matching percentages...');
    const matchedCampaignWithPercentage = campaigns.map((item, index) => {
      try {
        const interestPercentage = calculateInterestMatchingPercentage(
          user?.creator?.interests as never,
          item.campaignRequirement?.creator_persona as any,
        );

        const requirementPercentage = calculateRequirementMatchingPercentage(
          user?.creator as Creator,
          item.campaignRequirement as CampaignRequirement,
        );

        const overallMatchingPercentage = calculateOverallMatchingPercentage(interestPercentage, requirementPercentage);

        // Skip detailed matching logs for cleaner output

        return {
          ...item,
          percentageMatch: isNaN(overallMatchingPercentage) ? 0 : overallMatchingPercentage,
        };
      } catch (error) {
        console.error(`Error calculating percentage for campaign ${item.id}:`, error);
        return {
          ...item,
          percentageMatch: 0,
        };
      }
    });

    // Keep the original order from database (newest first) instead of overriding
    const sortedMatchedCampaigns = matchedCampaignWithPercentage;

    console.log('📦 Final campaigns to return:', sortedMatchedCampaigns.length);
    console.log('Campaign names being returned:', sortedMatchedCampaigns.map(c => c.name).join(', '));

    // Fix pagination logic: Check if we got the full 'take' amount from the database
    // We need to use originalFetchedCount (BEFORE filtering) not campaigns.length (AFTER filtering)
    // If we fetched the full 'take' amount, there might be more pages
    const hasNextPage = originalFetchedCount === Number(take);

    // For the cursor, we need to use the ORIGINAL last campaign ID from the database fetch
    // This ensures the next request starts from the correct position
    const lastCursor =
      hasNextPage && sortedMatchedCampaigns.length > 0
        ? sortedMatchedCampaigns[sortedMatchedCampaigns.length - 1]?.id
        : null;

    console.log('📄 Pagination:', { hasNextPage, lastCursor });

    const data = {
      data: {
        campaigns: sortedMatchedCampaigns,
      },
      metaData: {
        lastCursor: lastCursor,
        hasNextPage: hasNextPage,
      },
    };

    console.log('=== END DISCOVER PAGE DEBUG ===\n');

    return res.status(200).json(data);
  } catch (error) {
    console.error('❌ ERROR in matchCampaignWithCreator:', error);
    return res.status(400).json(error);
  }
};

export const creatorMakePitch = async (req: Request, res: Response) => {
  const { campaignId, content, type, followerCount } = req.body;
  const id = req.session.userid;
  let pitch;

  try {
    // Get campaign to check origin and credit tier setting
    const campaignWithOrigin = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        origin: true,
        submissionVersion: true,
        isCreditTier: true,
      },
    });

    if (!campaignWithOrigin) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // For credit tier campaigns, validate creator has follower data
    if (campaignWithOrigin.isCreditTier) {
      const { canPitchToCreditTierCampaign } = require('@services/creditTierService');
      const canPitch = await canPitchToCreditTierCampaign(id as string);

      if (!canPitch) {
        return res.status(403).json({
          message:
            'You must have follower data (Instagram, TikTok, or manually entered) to pitch to this campaign. Please connect your social media account or update your profile with your follower count.',
          code: 'NO_FOLLOWER_DATA',
        });
      }
    }

    // Check if creator has media kit (used for manualFollowerCount update decision)
    const creatorWithMediaKit = await prisma.creator.findUnique({
      where: { userId: id as string },
      select: {
        instagramUser: { select: { id: true } },
        tiktokUser: { select: { id: true } },
      },
    });

    const hasMediaKit = !!(creatorWithMediaKit?.instagramUser || creatorWithMediaKit?.tiktokUser);

    const isPitchExist = await prisma.pitch.findUnique({
      where: {
        userId_campaignId: {
          userId: id as string,
          campaignId: campaignId,
        },
      },
    });

    const isClientManagedFlow = campaignWithOrigin.origin === 'CLIENT' || campaignWithOrigin.submissionVersion === 'v4';
    const initialStatus = isClientManagedFlow ? 'PENDING_REVIEW' : 'undecided';

    if (isPitchExist) {
      if (isPitchExist.type === 'text') {
        pitch = await prisma.pitch.update({
          where: {
            id: isPitchExist.id,
          },
          data: {
            type: 'text',
            content: content,
            userId: id as string,
            campaignId: campaignId,
            status: 'PENDING_REVIEW',
            followerCount: followerCount || isPitchExist.followerCount,
          },
          include: {
            campaign: true,
            user: true,
          },
        });
      }
    } else {
      if (type === 'video') {
        pitch = await prisma.pitch.create({
          data: {
            type: 'video',
            content: content,
            userId: id as string,
            campaignId: campaignId,
            status: 'PENDING_REVIEW',
            followerCount: followerCount,
            outreachStatus: 'INTERESTED',
          },
          include: {
            campaign: true,
            user: true,
          },
        });
      } else {
        pitch = await prisma.pitch.create({
          data: {
            type: 'text',
            content: content,
            userId: id as string,
            campaignId: campaignId,
            status: 'PENDING_REVIEW',
            followerCount: followerCount,
            outreachStatus: 'INTERESTED',
          },
          include: {
            campaign: true,
            user: true,
          },
        });
      }
    }

    // Update Creator.manualFollowerCount if no media kit and followerCount provided
    if (!hasMediaKit && followerCount) {
      try {
        const followerCountInt = parseInt(followerCount, 10);
        if (!isNaN(followerCountInt) && followerCountInt > 0) {
          await prisma.creator.update({
            where: { userId: id as string },
            data: { manualFollowerCount: followerCountInt },
          });

          // Recalculate and update creator's credit tier based on new follower count
          const { updateCreatorTier } = require('@services/creditTierService');
          await updateCreatorTier(id as string);
        }
      } catch (error) {
        // Log error but don't fail pitch submission
        console.error('Failed to update manualFollowerCount or credit tier:', error);
      }
    }

    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        pitch: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: {
                  select: {
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (pitch) {
      // Log the pitch submission in campaign logs for Creator Activities tab
      const creatorName = user?.name || 'Creator';
      const campaignName = campaign?.name || 'Campaign';
      await prisma.campaignLog.create({
        data: {
          message: `${creatorName} submitted a pitch for ${campaignName}`,
          adminId: id as string,
          campaignId: campaignId,
        },
      });

      const notification = notificationPitch(pitch.campaign.name, 'Creator');
      const newPitch = await saveNotification({
        userId: user?.id as string,
        message: notification.message,
        title: notification.title,
        entity: 'Pitch',
        entityId: campaign?.id as string,
        pitchId: pitch.id,
      });

      io.to(clients.get(user?.id)).emit('notification', newPitch);

      const campaignManagers = campaign?.campaignAdmin;

      const notificationAdmin = notificationPitch(pitch.campaign.name, 'Admin', pitch.user.name as string);

      campaignManagers?.map(async (manager) => {
        const userRole = manager.admin.user.role;
        const userId = manager.adminId;

        if (userRole !== 'client') {
          const notification = await saveNotification({
            userId: userId as string,
            message: notificationAdmin.message,
            title: notificationAdmin.title,
            entity: 'Pitch',
            entityId: campaign?.id as string,
          });

          io.to(clients.get(manager)).emit('notification', notification);
        }
      });
    }

    return res.status(202).json({ message: 'Pitch submitted successfully!' });
  } catch (error) {
    return res.status(400).json({ message: 'Error! Please try again.' });
  }
};

export const getAllPitches = async (req: Request, res: Response) => {
  const userId = req.session.userid;

  try {
    // Get user role for role-based status display
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const pitches = await prisma.pitch.findMany({
      include: {
        campaign: true,
        user: true,
        admin: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!pitches || pitches.length === 0) {
      return res.status(404).json({ message: 'No pitches found.' });
    }

    // Transform pitches to show role-based status for client-created campaigns and filter for clients
    const transformedPitches = pitches
      .filter((pitch) => {
        // For clients: only show pitches that are SENT_TO_CLIENT or APPROVED
        // Hide pitches with PENDING_REVIEW status (admin review stage)
        if (user?.role === 'client' && pitch.campaign.origin === 'CLIENT') {
          return pitch.status === 'SENT_TO_CLIENT' || pitch.status === 'APPROVED';
        }
        // For admin and creators: show all pitches
        return true;
      })
      .map((pitch) => {
        let displayStatus = pitch.status;

        if (pitch.campaign.origin === 'CLIENT' && user) {
          // Role-based status display logic for client-created campaigns
          if (user.role === 'admin' || user.role === 'superadmin') {
            // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
            displayStatus = pitch.status;
          } else if (user.role === 'client') {
            // Client sees: SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
            if (pitch.status === 'SENT_TO_CLIENT') {
              displayStatus = 'PENDING_REVIEW';
            }
          } else if (user.role === 'creator') {
            // Creator sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
            if (pitch.status === 'SENT_TO_CLIENT') {
              displayStatus = 'PENDING_REVIEW';
            }
          }
        }

        return {
          ...pitch,
          displayStatus,
        };
      });

    return res.status(200).json({ pitches: transformedPitches });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

export const getAllCreatorAgreements = async (req: Request, res: Response) => {
  try {
    // Fetch all creator agreements with related User, Campaign, and Admin information
    const creatorAgreements = await prisma.creatorAgreement.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        admin: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const formattedCreatorAgreements = creatorAgreements.map((agreement) => ({
      id: agreement.id,
      agreementUrl: agreement.agreementUrl,
      createdAt: agreement.createdAt,
      completedAt: agreement.completedAt,
      turnaroundTime: agreement.completedAt
        ? Math.round((new Date(agreement.completedAt).getTime() - new Date(agreement.createdAt).getTime()) / 1000) // Calculate turnaround time in seconds
        : null,
      user: agreement.user,
      campaign: agreement.campaign,
      approvedByAdmin: agreement.admin?.user,
    }));

    // Return the formatted creator agreements
    return res.status(200).json(formattedCreatorAgreements);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

export const getCampaignsByCreatorId = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    const shortlisted = await prisma.shortListedCreator.findMany({
      where: {
        userId: userid,
      },
    });

    const campaignShortlistedIds = shortlisted.map((item: any) => item.campaignId);

    const campaigns = await Promise.all(
      campaignShortlistedIds.map(async (id) => {
        const campaign = await prisma.campaign.findUnique({
          where: {
            id: id,
          },
          include: {
            creatorAgreement: true,
            logistics: {
              include: {
                reservationDetails: {
                  select: {
                    outlet: true,
                    creatorRemarks: true,
                  },
                },
              },
            },
            company: true,
            brand: { include: { company: { include: { subscriptions: true } } } },
            campaignBrief: true,
            campaignRequirement: true,
            campaignTimeline: true,
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    role: true,
                  },
                },
              },
            },
            shortlisted: true,
          },
        });

        return { ...campaign };
      }),
    );

    return res.status(200).json({ campaigns });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCampaignForCreatorById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userid } = req.session as any;
  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        logistics: {
          include: {
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
                role: true,
              },
            },
          },
        },
        campaignTimeline: {
          where: {
            AND: [
              { for: 'creator' },
              {
                name: {
                  not: 'Open For Pitch',
                },
              },
            ],
          },
        },
        campaignBrief: true,
        campaignRequirement: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        shortlisted: true,
        invoice: true,
        submission: {
          where: {
            userId: userid,
          },
          include: {
            submissionType: true,
          },
        },
      },
    });

    if (!campaign) return res.status(404).json({ message: 'No campaign found.' });

    const agreement = await prisma.creatorAgreement.findUnique({
      where: {
        userId_campaignId: {
          userId: userid,
          campaignId: id,
        },
      },
    });

    const submissions = campaign.submission;
    let completed = 0;
    let totalSubmissions = 0;

    submissions?.forEach((submission) => {
      if (
        submission.status === 'APPROVED' ||
        submission.status === 'POSTED' ||
        submission.status === 'CLIENT_APPROVED' ||
        (submission.submissionType?.type === 'FIRST_DRAFT' && submission.status === 'CHANGES_REQUIRED')
      ) {
        completed++;
      }
    });

    const isChangesRequired =
      campaign.submission.find((submission) => submission.submissionType.type === 'FIRST_DRAFT')?.status ===
      'CHANGES_REQUIRED';

    totalSubmissions = campaign.campaignType === 'ugc' ? (isChangesRequired ? 3 : 2) : isChangesRequired ? 4 : 3;

    const adjustedData = {
      ...campaign,
      totalCompletion: ((completed / totalSubmissions) * 100).toFixed(),
      // totalCompletion:
      //   (campaign.submission.filter(
      //     (submission) =>
      //       submission.userId === userid &&
      //       (submission.status === 'APPROVED' ||
      //         submission.submissionType.type === 'FIRST_DRAFT' ||
      //         submission.status === 'CHANGES_REQUIRED'),
      //   ).length /
      //     campaign.submission.filter((submission) => submission.userId === userid).length) *
      //     100 || null,
    };

    // const adjustedCampaigns = campaigns.map((campaign) => {
    //   const submissions = campaign.submission;
    //   let completed = 0;
    //   let totalSubmissions = 0;

    //   submissions?.forEach((submission) => {
    //     if (
    //       submission.status === 'APPROVED' ||
    //       (submission.submissionType?.type === 'FIRST_DRAFT' && submission.status === 'CHANGES_REQUIRED')
    //     ) {
    //       completed++;
    //     }
    //   });

    //   const isChangesRequired =
    //     campaign.submission.find((submission) => submission.submissionType.type === 'FIRST_DRAFT')?.status ===
    //     'CHANGES_REQUIRED';

    //   totalSubmissions = campaign.campaignType === 'ugc' ? (isChangesRequired ? 3 : 2) : isChangesRequired ? 4 : 3;

    //   return {
    //     ...campaign,
    //     pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
    //     shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
    //     creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
    //     submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
    //     totalCompletion: ((completed / totalSubmissions) * 100).toFixed(),
    //   };
    // });

    return res.status(200).json({ ...adjustedData, agreement });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCampaignPitchForCreator = async (req: Request, res: Response) => {
  const userid = req.session.userid;

  try {
    const campaings = await prisma.pitch.findMany({
      where: {
        AND: [
          {
            userId: userid,
          },
          {
            AND: [
              {
                status: {
                  not: 'approved',
                },
              },
              {
                status: {
                  not: 'rejected',
                },
              },
            ],
          },
        ],
      },
      include: {
        campaign: {
          include: {
            campaignRequirement: true,
            campaignAdmin: true,
            company: true,
            brand: { include: { company: { include: { subscriptions: true } } } },
            campaignBrief: {
              select: {
                images: true,
                interests: true,
              },
            },
            pitch: true,
            shortlisted: true,
          },
        },
      },
    });
    return res.status(200).json(campaings);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getSubmission = async (req: Request, res: Response) => {
  const { userId, campaignId, submissionTypeId } = req.query;

  try {
    const submission = await prisma.submission.findMany({
      where: {
        userId: userId as string,
        campaignId: campaignId as string,
      },
      include: {
        submissionType: {
          select: {
            type: true,
          },
        },
      },
    });

    return res.status(200).json(submission);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCampaignLog = async (req: Request, res: Response) => {
  //console.log('=== BEGIN getCampaignLog ===');
  //console.log(req.params);
  //console.log('=== END getCampaignLog ===');

  const { id } = req.params;

  try {
    const campaignLog = await prisma.campaignLog.findMany({
      where: {
        campaignId: id,
      },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return res.status(200).json(campaignLog);
  } catch (error) {
    // TODO TEMP
    //console.log('=== BEGIN getCampaignLog error ===');
    //console.log(error);
    //console.log('=== END getCampaignLog error ===');
    return res.status(400).json({ message: 'Error fetching campaign logs', error });
  }
};

export const getPitchById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.session.userid;

  try {
    // Get user role for role-based status display
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const pitch = await prisma.pitch.findUnique({
      where: {
        id: id,
      },
      include: {
        user: {
          include: {
            creator: {
              include: {
                // industries: true,
                interests: true,
              },
            },
          },
        },
        campaign: true,
      },
    });

    if (!pitch) {
      return res.status(400).json({ message: 'Pitch not found.' });
    }

    // For clients: only allow access to pitches that are SENT_TO_CLIENT or APPROVED
    // Hide pitches with PENDING_REVIEW status (admin review stage)
    if (user?.role === 'client' && pitch.campaign.origin === 'CLIENT' && pitch.status === 'PENDING_REVIEW') {
      return res.status(403).json({ message: 'Access denied. This pitch is still under admin review.' });
    }

    // Add role-based status display for client-created campaigns
    let displayStatus = pitch.status;

    if (pitch.campaign.origin === 'CLIENT' && user) {
      // Role-based status display logic for client-created campaigns
      if (user.role === 'admin' || user.role === 'superadmin') {
        // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
        displayStatus = pitch.status;
      } else if (user.role === 'client') {
        // Client sees: SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
        if (pitch.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        }
      } else if (user.role === 'creator') {
        // Creator sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
        if (pitch.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        }
      }
    }

    return res.status(200).json({
      pitch: {
        ...pitch,
        displayStatus,
      },
    });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAllCampaignsByAdminId = async (req: Request<RequestQuery>, res: Response) => {
  const { userId } = req.params;
  // const { status, limit = 9, cursor } = req.query;

  const { cursor, limit = 10, search, status, excludeOwn, filterAdminId } = req.query;
  console.log('getAllCampaignsByAdminId called with:', { userId, status, search, limit, cursor, excludeOwn, filterAdminId });

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        admin: {
          select: {
            mode: true,
            role: true,
          },
        },
        id: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Build filter by specific admin condition if provided
    const filterAdminCondition = filterAdminId
      ? {
          campaignAdmin: {
            some: {
              adminId: filterAdminId as string,
            },
          },
        }
      : {};

    if (user.admin?.mode === 'god' || user.admin?.role?.name === 'CSL' || user.admin?.mode === 'advanced') {
      // Handle comma-separated status values
      let statusCondition = {};
      if (status) {
        const statusValues = (status as string).split(',');
        if (statusValues.length > 1) {
          statusCondition = {
            status: {
              in: statusValues as CampaignStatus[],
            },
          };
        } else {
          statusCondition = {
            status: statusValues[0] as CampaignStatus,
          };
        }
      }

      let companyIds: string[] = [];
      let brandIds: string[] = [];
      let clientIds: string[] = [];

      if (search) {
        // 1. Find companies with matching names
        const companies = await prisma.company.findMany({
          where: {
            name: {
              contains: search as string,
              mode: 'insensitive',
            },
          },
          select: {
            id: true,
            name: true,
          },
        });

        companyIds = companies.map((company) => company.id);
        console.log(
          'Found companies with matching names:',
          companies.map((c) => c.name),
        );

        // 2. Find brands with matching names directly
        const brandsByName = await prisma.brand.findMany({
          where: {
            name: {
              contains: search as string,
              mode: 'insensitive',
            },
          },
          select: {
            id: true,
            name: true,
          },
        });

        // 3. Also find brands that belong to companies with matching names
        let brandsByCompany: { id: string; name: string }[] = [];
        if (companyIds.length > 0) {
          brandsByCompany = await prisma.brand.findMany({
            where: {
              companyId: {
                in: companyIds,
              },
            },
            select: {
              id: true,
              name: true,
            },
          });
        }

        // Combine and deduplicate brand IDs
        const allBrands = [...brandsByName, ...brandsByCompany];
        brandIds = [...new Set(allBrands.map((brand) => brand.id))];
        console.log(
          'Found brands:',
          allBrands.map((b) => b.name),
        );

        // 4. Find clients with matching names
        const clients = await prisma.client.findMany({
          where: {
            user: {
              name: {
                contains: search as string,
                mode: 'insensitive',
              },
            },
          },
          select: {
            userId: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        });

        clientIds = clients.map((client) => client.userId);
        console.log(
          'Found clients with matching names:',
          clients.map((c) => c.user?.name),
        );
      }

      const campaigns: any = await prisma.campaign.findMany({
        take: Number(limit),
        ...(cursor && {
          skip: 1,
          cursor: { id: cursor as string },
        }),
        where: {
          AND: [
            statusCondition,
            filterAdminCondition,
            {
              ...(search && {
                OR: [
                  {
                    name: {
                      contains: search as string,
                      mode: 'insensitive',
                    },
                  },
                  ...(companyIds.length > 0
                    ? [
                        {
                          companyId: {
                            in: companyIds,
                          },
                        },
                      ]
                    : []),

                  ...(brandIds.length > 0
                    ? [
                        {
                          brandId: {
                            in: brandIds,
                          },
                        },
                      ]
                    : []),

                  // Search by client ID (if any clients matched the search)
                  ...(clientIds.length > 0
                    ? [
                        {
                          campaignClient: {
                            some: {
                              clientId: {
                                in: clientIds,
                              },
                            },
                          },
                        },
                      ]
                    : []),
                ],
              }),
            },
          ],
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          agreementTemplate: true,
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: { include: { company: { include: { subscriptions: true } } } },
          company: true,
          campaignTimeline: true,
          campaignBrief: true,
          campaignRequirement: true,
          campaignLogs: {
            include: {
              admin: true,
            },
          },
          campaignAdmin: {
            include: {
              admin: {
                include: {
                  role: true,
                  user: {
                    include: {
                      agreementTemplate: true,
                    },
                  },
                },
              },
            },
          },
          campaignSubmissionRequirement: true,
          pitch: {
            include: {
              user: {
                include: {
                  creator: {
                    include: {
                      interests: true,
                    },
                  },

                  paymentForm: true,
                },
              },
            },
          },
          shortlisted: {
            select: {
              user: {
                include: {
                  creator: true,
                },
              },
              userId: true,
            },
          },
          campaignTasks: {
            include: {
              campaignTaskAdmin: true,
            },
          },
          logistics: {
            include: {
              creator: true,
              reservationDetails: {
                select: {
                  outlet: true,
                  creatorRemarks: true,
                },
              },
            },
          },
          creatorAgreement: true,
        },
      });

      const totalActiveCampaigns = campaigns.filter((campaign: Campaign) => campaign.status === 'ACTIVE').length;
      const totalComletedCampaigns = campaigns.filter((campaign: Campaign) => campaign.status === 'COMPLETED').length;

      if (campaigns.length == 0) {
        return res.status(200).json({
          data: {
            campaigns: [],
          },
          metaData: {
            lastCursor: null,
            hasNextPage: false,
          },
        });
      }

      const lastCursor = campaigns.length > Number(limit) - 1 ? campaigns[Number(limit) - 1].id : null;

      const data = {
        data: {
          campaigns,
          totalCampaigns: campaigns?.length,
          totalActiveCampaigns,
          totalComletedCampaigns,
        },
        metaData: {
          lastCursor: lastCursor,
        },
      };

      return res.status(200).json(data);
    }

    // Handle comma-separated status values for non-superadmin users
    let statusCondition = {};
    if (status) {
      const statusValues = (status as string).split(',');
      if (statusValues.length > 1) {
        statusCondition = {
          status: {
            in: statusValues as CampaignStatus[],
          },
        };
      } else {
        statusCondition = {
          status: statusValues[0] as CampaignStatus,
        };
      }
    }

    console.log('Non-superadmin user, status condition:', statusCondition);

    const campaigns = await prisma.campaign.findMany({
      take: Number(limit),
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor as string },
      }),
      where: {
        AND: [
          // When excludeOwn=true, show campaigns NOT managed by this user (for "All" tab)
          // Otherwise, show only campaigns managed by this user
          excludeOwn === 'true'
            ? {
                campaignAdmin: {
                  none: {
                    adminId: user.id,
                  },
                },
              }
            : {
                campaignAdmin: {
                  some: {
                    adminId: user.id,
                  },
                },
              },
          // Force ACTIVE status when excludeOwn=true, otherwise use the provided status filter
          excludeOwn === 'true' ? { status: 'ACTIVE' as CampaignStatus } : statusCondition,
          // Filter by specific admin if provided
          filterAdminCondition,
          {
            ...(search && {
              name: {
                contains: search as string,
                mode: 'insensitive',
              },
            }),
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      // where: {
      //   ...(status
      //     ? {
      //         AND: [
      //           {
      //             campaignAdmin: {
      //               some: {
      //                 adminId: user.id,
      //               },
      //             },
      //           },
      //           {
      //             status: status as any,
      //           },
      //         ],
      //       }
      //     : {
      //         campaignAdmin: {
      //           some: {
      //             adminId: user.id,
      //           },
      //         },
      //       }),
      // },
      include: {
        agreementTemplate: true,
        submission: {
          include: {
            submissionType: true,
            dependencies: true,
          },
        },
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignLogs: {
          include: {
            admin: true,
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: {
                  include: {
                    agreementTemplate: true,
                  },
                },
              },
            },
          },
        },
        campaignSubmissionRequirement: true,
        pitch: {
          include: {
            user: {
              include: {
                creator: {
                  include: {
                    interests: true,
                  },
                },

                paymentForm: true,
              },
            },
          },
        },
        shortlisted: {
          select: {
            user: {
              include: {
                creator: true,
              },
            },
            userId: true,
          },
        },
        campaignTasks: {
          include: {
            campaignTaskAdmin: true,
          },
        },
        logistics: {
          include: {
            creator: true,
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
        creatorAgreement: true,
      },
    });

    console.log(`Found ${campaigns.length} campaigns for non-superadmin user ${user.id}`);
    if (campaigns.length > 0) {
      console.log(
        'Campaign statuses:',
        campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      );
    }

    const totalActiveCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;

    const totalComletedCampaigns = campaigns.filter((campaign) => campaign.status === 'COMPLETED').length;

    if (campaigns.length == 0) {
      return res.status(200).json({
        data: {
          campaigns: [],
        },
        metaData: {
          lastCursor: null,
          hasNextPage: false,
        },
      });
    }

    const lastCursor = campaigns.length > Number(limit) - 1 ? campaigns[Number(limit) - 1].id : null;

    const data = {
      data: {
        campaigns,
        totalCampaigns: campaigns?.length,
        totalActiveCampaigns,
        totalComletedCampaigns,
      },
      metaData: {
        lastCursor: lastCursor,
      },
    };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

// For creator
export const getMyCampaigns = async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        pitch: true,
        shortlisted: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const campaigns = await prisma.campaign.findMany({
      where: {
        OR: [
          {
            shortlisted: {
              some: {
                userId: user.id,
              },
            },
          },
          {
            pitch: {
              some: {
                userId: user.id,
              },
            },
          },
        ],
      },
      include: {
        logistics: {
          include: {
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        invoice: true,
        shortlisted: {
          where: {
            userId: user.id,
          },
        },
        pitch: {
          where: {
            userId: user.id,
          },
        },
        campaignBrief: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
                role: true,
              },
            },
          },
        },
        campaignRequirement: true,

        creatorAgreement: {
          where: {
            userId: user.id,
          },
        },
        submission: {
          where: {
            userId: user.id,
          },
          include: {
            submissionType: true,
            dependencies: true,
            dependentOn: true,
          },
        },
        campaignTimeline: {
          where: {
            AND: [
              { for: 'creator' },
              {
                name: {
                  not: 'Open For Pitch',
                },
              },
            ],
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Sort by newest first to match discover page
      },
    });

    // const checkCondition = (submission: any) => {
    //   console.log(submission);
    //   if (submission.userId === user.id) {
    //     return submission;
    //     // if (
    //     //   // (submission.submissionType.type === 'FIRST_DRAFT' &&
    //     //   //   (submission.status === 'APPROVED' || submission.status === 'CHANGES_REQUIRED')) ||
    //     //   submission.status === 'APPROVED'
    //     // ) {
    //     //   return submission;
    //     // }
    //   }
    // };
    // const checkCondition = (submission: any) => {
    //   console.log(submission);
    //   if (submission.userId === user.id) {
    //     return submission;
    //     // if (
    //     //   // (submission.submissionType.type === 'FIRST_DRAFT' &&
    //     //   //   (submission.status === 'APPROVED' || submission.status === 'CHANGES_REQUIRED')) ||
    //     //   submission.status === 'APPROVED'
    //     // ) {
    //     //   return submission;
    //     // }
    //   }
    // };
    // const checkCondition = (submission: any) => {
    //   console.log(submission);
    //   if (submission.userId === user.id) {
    //     return submission;
    //     // if (
    //     //   // (submission.submissionType.type === 'FIRST_DRAFT' &&
    //     //   //   (submission.status === 'APPROVED' || submission.status === 'CHANGES_REQUIRED')) ||
    //     //   submission.status === 'APPROVED'
    //     // ) {
    //     //   return submission;
    //     // }
    //   }
    // };

    // const adjustedCampaigns = campaigns.map((campaign) => ({
    //   ...campaign,
    //   pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
    //   shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
    //   creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
    //   submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
    //   totalCompletion:
    //     (campaign.submission.filter(
    //       (submission) =>
    //         submission.userId === userId &&
    //         (submission.status === 'APPROVED' ||
    //           submission.submissionType.type === 'FIRST_DRAFT' ||
    //           submission.status === 'CHANGES_REQUIRED'),
    //     ).length /
    //       campaign.submission.filter((submission) => submission.userId === user.id).length) *
    //       100 || null,
    // }));

    const adjustedCampaigns = campaigns.map((campaign) => {
      const submissions = campaign.submission;
      let completed = 0;
      let totalSubmissions = 0;

      submissions?.forEach((submission) => {
        if (
          submission.status === 'APPROVED' ||
          submission.status === 'POSTED' ||
          submission.status === 'CLIENT_APPROVED' ||
          (submission.submissionType?.type === 'FIRST_DRAFT' && submission.status === 'CHANGES_REQUIRED')
        ) {
          completed++;
        }
      });

      const isChangesRequired =
        campaign.submission.find((submission) => submission.submissionType.type === 'FIRST_DRAFT')?.status ===
        'CHANGES_REQUIRED';

      totalSubmissions = campaign.campaignType === 'ugc' ? (isChangesRequired ? 3 : 2) : isChangesRequired ? 4 : 3;

      return {
        ...campaign,
        pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
        shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
        creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
        submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
        totalCompletion: ((completed / totalSubmissions) * 100).toFixed(),
      };
    });

    return res.status(200).json(adjustedCampaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const changeCampaignStage = async (req: Request, res: Response) => {
  const { status } = req.body;
  const { campaignId } = req.params;
  const adminId = req.session.userid;

  let updatedCampaign: any;
  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: { select: { startDate: true } },
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    if (dayjs(campaign.campaignBrief?.startDate).isAfter(dayjs(), 'date')) {
      updatedCampaign = await prisma.campaign.update({
        where: {
          id: campaignId,
        },
        data: {
          status: 'SCHEDULED',
        },
        include: {
          campaignAdmin: true,
          shortlisted: {
            include: {
              user: true,
            },
          },
        },
      });
    } else {
      updatedCampaign = await prisma.campaign.update({
        where: {
          id: campaignId,
        },
        data: {
          status: status,
        },
        include: {
          campaignAdmin: true,
          shortlisted: {
            include: {
              user: true,
            },
          },
        },
      });
    }

    if (updatedCampaign?.status === 'PAUSED' && adminId) {
      const adminLogMessage = `Paused the campaign - ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    if (updatedCampaign?.shortlisted.length > 0 && updatedCampaign?.status === 'PAUSED') {
      updatedCampaign?.shortlisted?.map(async (value: { userId: string }) => {
        const { title, message } = notificationMaintenance(updatedCampaign.name);

        const data = await saveNotification({
          userId: value.userId as string,
          title: title,
          message: message,
          entity: 'Status',
          entityId: updatedCampaign.id,
        });
        io.to(clients.get(value.userId)).emit('notification', data);
      });
    }

    if (updatedCampaign?.status === 'ACTIVE') {
      for (const admin of updatedCampaign.campaignAdmin) {
        const { title, message } = notificationCampaignLive(updatedCampaign.name);

        const data = await saveNotification({
          userId: admin.adminId,
          title: title,
          message: message,
          entity: 'Status',
          entityId: updatedCampaign.id,
        });
        io.to(clients.get(admin.adminId)).emit('notification', data);
      }
    }

    if (updatedCampaign?.status === 'ACTIVE') {
      // Get admin info for logging
      const admin = await prisma.user.findUnique({
        where: { id: adminId },
      });
      const adminName = admin?.name || 'Admin';
      const userRole = admin?.role || 'admin';

      // Log campaign activity for activation
      const campaignActivityMessage = `Campaign Activated`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaignId,
        },
      });

      const adminLogMessage = `Resumed the campaign - ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    io.emit('campaignStatus', updatedCampaign);

    return res.status(200).json({ message: 'Campaign stage changed successfully.', status: updatedCampaign?.status });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const closeCampaign = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: {
        status: 'COMPLETED',
      },
      include: {
        campaignAdmin: true,
      },
    });
    campaign.campaignAdmin.forEach(async (item) => {
      const data = await saveNotification({
        userId: item.adminId,
        message: `${campaign.name} is close on ${dayjs().format('ddd LL')}`,
        entity: 'Campaign',
        entityId: campaign.id,
      });
      io.to(clients.get(item.adminId)).emit('notification', data);
    });

    if (adminId) {
      const adminLogMessage = `Closed campaign ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Campaign closed successfully.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// export const editCampaign = async (req: Request, res: Response) => {
//   const { id, name, desc, brief, admin } = req.body;
//   try {
//     const updatedCampaign = await prisma.campaign.update({
//       where: { id: id },
//       data: {
//         name: name,
//         description: desc,
//         campaignBrief: brief,
//         campaignAdmin: admin,
//       },
//     });
//     return res.status(200).json({ message: 'Succesfully updated', ...updatedCampaign });
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// };

export const editCampaignInfo = async (req: Request, res: Response) => {
  const {
    id,
    name,
    description,
    campaignIndustries,
    isKWSPCampaign,
    spreadSheetURL,
    // New fields from frontend
    brandAbout,
    productName,
    websiteLink,
    campaignStartDate,
    campaignEndDate,
  } = req.body;
  const adminId = req.session.userid;

  const publicURL: string[] = [];
  if (req.files && (req.files as any).campaignImages) {
    const images = Array.isArray((req.files as any).campaignImages)
      ? (req.files as any).campaignImages
      : [(req.files as any).campaignImages];

    for (const image of images) {
      // Use your existing image upload function
      const url = await uploadCompanyLogo(image.tempFilePath, image.name);
      publicURL.push(url);
    }
  }

  try {
    console.log('editCampaignInfo received:', {
      id,
      name,
      description,
      brandAbout,
      productName,
      websiteLink,
      campaignIndustries,
      campaignStartDate,
      campaignEndDate,
      campaignImage: publicURL,
    });

    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: {
        name: name,
        description: description,
        isKWSPCampaign,
        spreadSheetURL,
        // Update Campaign model fields
        ...(brandAbout !== undefined && { brandAbout }),
        ...(productName !== undefined && { productName }),
        ...(websiteLink !== undefined && { websiteLink }),
      },
    });

    const updatedCampaignBrief = await prisma.campaignBrief.update({
      where: {
        campaignId: id,
      },
      data: {
        ...(campaignIndustries && { industries: campaignIndustries }),
        // Update CampaignBrief model fields
        ...(campaignStartDate && { startDate: new Date(campaignStartDate) }),
        ...(campaignEndDate && { endDate: new Date(campaignEndDate) }),
        // Only update images if new ones were uploaded
        ...(publicURL.length > 0 && { images: publicURL }),
      },
    });

    // Get admin info for logging
    if (adminId) {
      const campaignActivityMessage = `Campaign Details edited - [Campaign General Information]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: id,
        },
      });

      const adminLogMessage = `Updated campaign info for campaign - ${name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res
      .status(200)
      .json({ message: 'Campaign information updated successfully', campaign: updatedCampaign, brief: updatedCampaignBrief });
  } catch (error) {
    console.error('editCampaignInfo error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to update campaign', error });
  }
};

export const editCampaignObjectives = async (req: Request, res: Response) => {
  const {
    id,
    objectives,
    secondaryObjectives,
    boostContent,
    primaryKPI,
    performanceBaseline,
  } = req.body;
  const adminId = req.session.userid;

  try {
    console.log('editCampaignObjectives received:', {
      id,
      objectives,
      secondaryObjectives,
      boostContent,
      primaryKPI,
      performanceBaseline,
    });

    // Get campaign name for logging
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { name: true },
    });

    const updatedCampaignBrief = await prisma.campaignBrief.update({
      where: {
        campaignId: id,
      },
      data: {
        ...(objectives !== undefined && { objectives }),
        ...(secondaryObjectives !== undefined && { secondaryObjectives }),
        ...(boostContent !== undefined && { boostContent }),
        ...(primaryKPI !== undefined && { primaryKPI }),
        ...(performanceBaseline !== undefined && { performanceBaseline }),
      },
    });

    // Log the change
    if (adminId) {
      const campaignActivityMessage = `Campaign Details edited - [Campaign Objectives]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: id,
        },
      });

      const adminLogMessage = `Updated campaign objectives for campaign - ${campaign?.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res
      .status(200)
      .json({ message: 'Campaign objectives updated successfully', brief: updatedCampaignBrief });
  } catch (error) {
    console.error('editCampaignObjectives error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to update campaign objectives', error });
  }
};

export const editCampaignBrandOrCompany = async (req: Request, res: Response) => {
  const {
    id,
    // `campaignBrand.id` can be either a brand ID or company ID
    campaignBrand,
  } = req.body;

  try {
    // If `null`, then `campaignBrand.id` is a company ID
    const brand = await prisma.brand.findUnique({
      where: {
        id: campaignBrand.id,
      },
    });
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: brand
        ? {
            brandId: campaignBrand.id,
            companyId: null,
          }
        : {
            brandId: null,
            companyId: campaignBrand.id,
          },
    });

    const adminId = req.session.userid;

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing company
      const campaignActivityMessage = `Campaign Details edited - [Company]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: updatedCampaign.id,
        },
      });

      const adminLogMessage = `Updated ${brand ? 'brand' : 'company'}`;
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: 'Company updated successfully', ...updatedCampaign });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignDosAndDonts = async (req: Request, res: Response) => {
  const { campaignId, campaignDo, campaignDont } = req.body;

  try {
    const updatedCampaignBrief = await prisma.campaignBrief.update({
      where: {
        campaignId: campaignId,
      },
      data: {
        campaigns_do: campaignDo,
        campaigns_dont: campaignDont,
      },
    });

    const adminId = req.session.userid;

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing do's and don'ts
      const campaignActivityMessage = `Campaign Details edited - [Do's and Don'ts]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaignId,
        },
      });

      const adminLogMessage = "Updated do's and don'ts.";
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: "Do's and don'ts updated successfully", ...updatedCampaignBrief });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignRequirements = async (req: Request, res: Response) => {
  const {
    campaignId,
    // Primary Audience
    audienceGender,
    audienceAge,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    country,
    countries,
    // Secondary Audience
    secondaryAudienceGender,
    secondaryAudienceAge,
    secondaryAudienceLanguage,
    secondaryAudienceCreatorPersona,
    secondaryAudienceUserPersona,
    secondaryCountry,
    // Geographic Focus
    geographicFocus,
    geographicFocusOthers,
  } = req.body;

  try {
    // Finalize countries - combine country, secondaryCountry, and geographicFocusOthers
    let finalizedCountries: string[] = [];
    if (typeof country === 'string' && country) {
      finalizedCountries.push(country);
    } else if (Array.isArray(country) && country.length > 0) {
      finalizedCountries.push(...country);
    }
    if (typeof secondaryCountry === 'string' && secondaryCountry) {
      finalizedCountries.push(secondaryCountry);
    } else if (Array.isArray(secondaryCountry) && secondaryCountry.length > 0) {
      finalizedCountries.push(...secondaryCountry);
    }
    if (typeof geographicFocusOthers === 'string' && geographicFocusOthers) {
      finalizedCountries.push(geographicFocusOthers);
    } else if (Array.isArray(geographicFocusOthers) && geographicFocusOthers.length > 0) {
      finalizedCountries.push(...geographicFocusOthers);
    }
    // Remove duplicates
    finalizedCountries = [...new Set(finalizedCountries)];

    const updatedCampaignRequirement = await prisma.campaignRequirement.update({
      where: {
        campaignId: campaignId,
      },
      data: {
        // Primary Audience
        gender: audienceGender,
        age: audienceAge,
        language: audienceLanguage,
        creator_persona: audienceCreatorPersona,
        user_persona: audienceUserPersona,
        country: finalizedCountries[0] || country || '',
        countries: finalizedCountries,
        // Secondary Audience
        ...(secondaryAudienceGender !== undefined && { secondary_gender: secondaryAudienceGender }),
        ...(secondaryAudienceAge !== undefined && { secondary_age: secondaryAudienceAge }),
        ...(secondaryAudienceLanguage !== undefined && { secondary_language: secondaryAudienceLanguage }),
        ...(secondaryAudienceCreatorPersona !== undefined && { secondary_creator_persona: secondaryAudienceCreatorPersona }),
        ...(secondaryAudienceUserPersona !== undefined && { secondary_user_persona: secondaryAudienceUserPersona }),
        ...(secondaryCountry !== undefined && { secondary_country: secondaryCountry }),
        // Geographic Focus
        ...(geographicFocus !== undefined && { geographic_focus: geographicFocus }),
        ...(geographicFocusOthers !== undefined && { geographicFocusOthers: geographicFocusOthers }),
      },
      include: {
        campaign: { select: { name: true } },
      },
    });

    const adminId = req.session.userid;

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing campaign requirements
      const campaignActivityMessage = `Campaign Details edited - [Campaign Requirements]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaignId,
        },
      });

      const adminmessage = `Update Campaign requirements for campaign - ${updatedCampaignRequirement.campaign.name} `;
      logAdminChange(adminmessage, adminId, req);
    }

    return res
      .status(200)
      .json({ message: 'Campaign requirements updated successfully', newRequirement: updatedCampaignRequirement });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignLogistics = async (req: Request, res: Response) => {
  const {
    campaignId,
    logisticsType,
    // Product Delivery
    products,
    // Reservation
    schedulingOption,
    allowMultipleBookings,
    locations,
    availabilityRules,
    clientRemarks,
  } = req.body;

  const adminId = req.session.userid;

  try {
    // Update campaign logistics type
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        logisticsType: logisticsType && logisticsType !== '' ? (logisticsType as LogisticType) : null,
      },
      select: { name: true },
    });

    // Handle Product Delivery - update products
    if (logisticsType === 'PRODUCT_DELIVERY' && products) {
      // Delete existing products
      await prisma.product.deleteMany({
        where: { campaignId },
      });

      // Create new products
      const validProducts = products.filter((p: { name: string }) => p.name && p.name.trim() !== '');
      if (validProducts.length > 0) {
        await prisma.product.createMany({
          data: validProducts.map((p: { name: string }) => ({
            campaignId,
            productName: p.name,
          })),
        });
      }
    }

    // Handle Reservation - update or create reservation config
    if (logisticsType === 'RESERVATION') {
      const reservationMode = schedulingOption === 'auto' ? 'AUTO_SCHEDULE' : 'MANUAL_CONFIRMATION';

      await prisma.reservationConfiguration.upsert({
        where: { campaignId },
        update: {
          mode: reservationMode,
          allowMultipleBookings: allowMultipleBookings || false,
          locations: locations || [],
          availabilityRules: availabilityRules || [],
          clientRemarks: clientRemarks || null,
        },
        create: {
          campaignId,
          mode: reservationMode,
          allowMultipleBookings: allowMultipleBookings || false,
          locations: locations || [],
          availabilityRules: availabilityRules || [],
          clientRemarks: clientRemarks || null,
        },
      });
    }

    // Clear reservation config if switching away from reservation
    if (logisticsType !== 'RESERVATION') {
      await prisma.reservationConfiguration.deleteMany({
        where: { campaignId },
      });
    }

    // Clear products if switching away from product delivery
    if (logisticsType !== 'PRODUCT_DELIVERY') {
      await prisma.product.deleteMany({
        where: { campaignId },
      });
    }

    // Log the change
    if (adminId) {
      const campaignActivityMessage = `Campaign Details edited - [Campaign Logistics]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaignId,
        },
      });

      const adminLogMessage = `Updated campaign logistics for campaign - ${updatedCampaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Campaign logistics updated successfully' });
  } catch (error) {
    console.error('editCampaignLogistics error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to update campaign logistics', error });
  }
};

export const editCampaignFinalise = async (req: Request, res: Response) => {
  const {
    campaignId,
    campaignManagers,
    campaignType,
    deliverables,
  } = req.body;

  const adminId = req.session.userid;

  try {
    // Get campaign for logging with current campaignType and submission version
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        campaignAdmin: {
          include: {
            admin: {
              include: {
                role: true,
                user: true,
              },
            },
          },
        },
        campaignBrief: true,
        campaignTimeline: true,
        company: {
          include: {
            clients: {
              include: { user: true },
            },
          },
        },
        brand: {
          include: {
            company: {
              include: {
                clients: {
                  include: { user: true },
                },
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const previousCampaignType = campaign.campaignType;

    const rawFootage = deliverables?.includes('RAW_FOOTAGES') || false;
    const photos = deliverables?.includes('PHOTOS') || false;
    const ads = deliverables?.includes('ADS') || false;
    const crossPosting = deliverables?.includes('CROSS_POSTING') || false;

    // Update campaign basic fields including deliverables
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        campaignType: campaignType || 'normal',
        rawFootage,
        photos,
        ads,
        crossPosting,
      },
    });

    // Handle timeline changes when campaignType changes
    const newCampaignType = campaignType || 'normal';
    if (previousCampaignType !== newCampaignType) {
      if (newCampaignType === 'ugc') {
        // Changed to UGC - remove Posting timeline if it exists
        await prisma.campaignTimeline.deleteMany({
          where: {
            campaignId,
            name: 'Posting',
          },
        });
        console.log('Removed Posting timeline for UGC campaign');
      } else if (previousCampaignType === 'ugc' && newCampaignType === 'normal') {
        // Changed from UGC to Normal - add Posting timeline if it doesn't exist
        const existingPostingTimeline = await prisma.campaignTimeline.findFirst({
          where: {
            campaignId,
            name: 'Posting',
          },
        });

        if (!existingPostingTimeline) {
          // Get the posting submission type
          const postingType = await prisma.submissionType.findFirst({
            where: { type: 'POSTING' },
          });

          if (postingType && campaign.campaignBrief) {
            // Get the final draft timeline to determine posting start date
            const finalDraftTimeline = await prisma.campaignTimeline.findFirst({
              where: {
                campaignId,
                name: 'Final Draft',
              },
            });

            // Use posting dates from brief if available, otherwise use final draft end date or campaign end date
            const postingStartDate = campaign.campaignBrief.postingStartDate
              || finalDraftTimeline?.endDate
              || campaign.campaignBrief.endDate;
            const postingEndDate = campaign.campaignBrief.postingEndDate
              || campaign.campaignBrief.endDate;

            // Calculate duration
            const postingDuration = Math.max(
              1,
              Math.floor((new Date(postingEndDate).getTime() - new Date(postingStartDate).getTime()) / (1000 * 60 * 60 * 24)),
            );

            // Get the highest order from existing timelines
            const maxOrderTimeline = await prisma.campaignTimeline.findFirst({
              where: { campaignId },
              orderBy: { order: 'desc' },
            });
            const postingOrder = (maxOrderTimeline?.order || 4) + 1;

            await prisma.campaignTimeline.create({
              data: {
                name: 'Posting',
                for: 'creator',
                duration: postingDuration,
                startDate: new Date(postingStartDate),
                endDate: new Date(postingEndDate),
                order: postingOrder,
                status: 'OPEN',
                campaignId,
                submissionTypeId: postingType.id,
              },
            });
            console.log('Added Posting timeline for normal campaign');
          }
        }
      }
    }

    // Update campaign admins (managers)
    if (campaignManagers && Array.isArray(campaignManagers)) {
      // Get admin records for the campaign managers with user role info
      const adminRecords = await Promise.all(
        campaignManagers.map(async (manager: { id: string }) => {
          const adminRecord = await prisma.admin.findFirst({
            where: { userId: manager.id },
            include: {
              user: {
                select: {
                  id: true,
                  role: true,
                },
              },
              role: {
                select: {
                  name: true,
                },
              },
            },
          });
          return adminRecord;
        }),
      );

      const validAdminRecords = adminRecords.filter((admin) => admin !== null);
      const validAdminIds = validAdminRecords.map((admin) => admin!.userId);

      // Check if any manager being added is a client user
      const hasClientAdmin = validAdminRecords.some((admin: any) => {
        return admin?.user?.role === 'client' || admin?.role?.name === 'Client';
      });

      // Get existing CSM and Client campaign admins
      const existingAdmins = await prisma.campaignAdmin.findMany({
        where: { campaignId },
        include: {
          admin: {
            include: { 
              role: true,
              user: true,
            },
          },
        },
      });

      // Get CSM and Client admins that should be managed by this form
      const managedAdmins = existingAdmins.filter(
        (ca) => ca.admin?.role?.name === 'CSM' || ca.admin?.role?.name === 'Client' || ca.admin?.user?.role === 'client'
      );

      // Find admins that need to be removed (in existing but not in new list)
      const adminsToRemove = managedAdmins.filter(
        (ca) => !validAdminIds.includes(ca.adminId)
      );

      // Delete removed admins from campaignAdmin
      if (adminsToRemove.length > 0) {
        const adminIdsToRemove = adminsToRemove.map((ca) => ca.adminId);
        await prisma.campaignAdmin.deleteMany({
          where: {
            campaignId,
            adminId: { in: adminIdsToRemove },
          },
        });

        // For client users being removed, also remove them from CampaignClient
        for (const removedAdmin of adminsToRemove) {
          const isClientUser = removedAdmin.admin?.user?.role === 'client' || removedAdmin.admin?.role?.name === 'Client';

          if (isClientUser && removedAdmin.adminId) {
            try {
              // Find the client record for this user
              const clientRecord = await prisma.client.findUnique({
                where: { userId: removedAdmin.adminId },
              });

              if (clientRecord) {
                // Check if exists in CampaignClient before deleting
                const existingCampaignClient = await prisma.campaignClient.findUnique({
                  where: {
                    clientId_campaignId: {
                      clientId: clientRecord.id,
                      campaignId: campaignId,
                    },
                  },
                });

                if (existingCampaignClient) {
                  await prisma.campaignClient.delete({
                    where: {
                      clientId_campaignId: {
                        clientId: clientRecord.id,
                        campaignId: campaignId,
                      },
                    },
                  });
                  console.log(`Removed client ${clientRecord.id} from CampaignClient for campaign ${campaignId}`);
                }
              }
            } catch (error) {
              console.error(`Error removing client user ${removedAdmin.adminId} from CampaignClient:`, error);
              // Don't fail the edit if CampaignClient removal fails
            }
          }
        }
      }

      // Check if any client users remain in the campaign managers after updates
      // If no client users remain, revert submissionVersion to v2
      if (!hasClientAdmin) {
        // Check remaining campaign admins for any client users
        const remainingAdmins = await prisma.campaignAdmin.findMany({
          where: { campaignId },
          include: {
            admin: {
              include: {
                role: true,
                user: true,
              },
            },
          },
        });

        const hasRemainingClientAdmin = remainingAdmins.some(
          (ca) => ca.admin?.user?.role === 'client' || ca.admin?.role?.name === 'Client'
        );

        if (!hasRemainingClientAdmin && campaign.submissionVersion === 'v4') {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { submissionVersion: 'v2' },
          });
          console.log(`Reverted campaign ${campaignId} to v2 (no client admins remaining)`);
        }
      }

      // Create new campaign admin entries for the managers
      for (const managerId of validAdminIds) {
        const exists = await prisma.campaignAdmin.findUnique({
          where: {
            adminId_campaignId: {
              adminId: managerId,
              campaignId,
            },
          },
        });

        if (!exists) {
          await prisma.campaignAdmin.create({
            data: {
              adminId: managerId,
              campaignId,
            },
          });
        }
      }

      // If a client user is added, update submissionVersion to v4 and add to CampaignClient
      if (hasClientAdmin) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { submissionVersion: 'v4' },
        });

        // For client users being added as campaign admins, also add them to CampaignClient
        // This ensures they are tracked in both models for v4 campaigns
        for (const admin of validAdminRecords) {
          const isClientUser = admin?.user?.role === 'client' || admin?.role?.name === 'Client';

          if (isClientUser && admin?.userId) {
            try {
              // Find the client record for this user
              const clientRecord = await prisma.client.findUnique({
                where: { userId: admin.userId },
              });

              if (clientRecord) {
                // Check if already in CampaignClient
                const existingCampaignClient = await prisma.campaignClient.findUnique({
                  where: {
                    clientId_campaignId: {
                      clientId: clientRecord.id,
                      campaignId: campaignId,
                    },
                  },
                });

                if (!existingCampaignClient) {
                  await prisma.campaignClient.create({
                    data: {
                      clientId: clientRecord.id,
                      campaignId: campaignId,
                      role: 'owner',
                    },
                  });
                  console.log(`Added client ${clientRecord.id} to CampaignClient for campaign ${campaignId}`);
                }
              }
            } catch (error) {
              console.error(`Error adding client user ${admin.userId} to CampaignClient:`, error);
              // Don't fail the edit if CampaignClient integration fails
            }
          }
        }
      }
    }

    // Log the change
    if (adminId) {
      const campaignActivityMessage = `Campaign Details edited - [Campaign Finalise Settings]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaignId,
        },
      });

      // Check if campaign version changed
      const updatedCampaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { submissionVersion: true },
      });
      const wasConvertedToV4 = updatedCampaign?.submissionVersion === 'v4' && campaign.submissionVersion !== 'v4';
      const wasRevertedToV2 = updatedCampaign?.submissionVersion === 'v2' && campaign.submissionVersion === 'v4';

      let adminLogMessage = `Updated campaign finalise settings for campaign - ${campaign.name}`;
      if (wasConvertedToV4) {
        adminLogMessage = `Updated campaign finalise settings for campaign - ${campaign.name} and converted to V4 (client added)`;
      } else if (wasRevertedToV2) {
        adminLogMessage = `Updated campaign finalise settings for campaign - ${campaign.name} and reverted to V2 (all clients removed)`;
      }
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Campaign finalise settings updated successfully' });
  } catch (error) {
    console.error('editCampaignFinalise error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to update campaign finalise settings', error });
  }
};

export const editCampaignAdditionalDetails = async (req: Request, res: Response) => {
  const adminId = req.session.userid;

  try {
    // Handle both JSON body and FormData
    let campaignId: string;
    let socialMediaPlatform: string[] | undefined;
    let contentFormat: string[] | undefined;
    let postingStartDate: string | undefined;
    let postingEndDate: string | undefined;
    let mainMessage: string | undefined;
    let keyPoints: string | undefined;
    let toneAndStyle: string | undefined;
    let referenceContent: string | undefined;
    let hashtagsToUse: string | undefined;
    let mentionsTagsRequired: string | undefined;
    let creatorCompensation: string | undefined;
    let ctaDesiredAction: string | undefined;
    let ctaLinkUrl: string | undefined;
    let ctaPromoCode: string | undefined;
    let ctaLinkInBioRequirements: string | undefined;
    let specialNotesInstructions: string | undefined;
    let needAds: string | undefined;
    let existingBrandGuidelinesUrls: string | undefined;
    let existingProductImage1Url: string | undefined;
    let existingProductImage2Url: string | undefined;
    let clearBrandGuidelines: boolean = false;
    let clearProductImage1: boolean = false;
    let clearProductImage2: boolean = false;

    // Check if this is FormData (multipart) or JSON
    if (req.body.campaignId && typeof req.body.campaignId === 'string') {
      // FormData parsing
      campaignId = req.body.campaignId;
      socialMediaPlatform = req.body.socialMediaPlatform ? JSON.parse(req.body.socialMediaPlatform) : undefined;
      contentFormat = req.body.contentFormat ? JSON.parse(req.body.contentFormat) : undefined;
      postingStartDate = req.body.postingStartDate || undefined;
      postingEndDate = req.body.postingEndDate || undefined;
      mainMessage = req.body.mainMessage || undefined;
      keyPoints = req.body.keyPoints || undefined;
      toneAndStyle = req.body.toneAndStyle || undefined;
      referenceContent = req.body.referenceContent || undefined;
      hashtagsToUse = req.body.hashtagsToUse || undefined;
      mentionsTagsRequired = req.body.mentionsTagsRequired || undefined;
      creatorCompensation = req.body.creatorCompensation || undefined;
      ctaDesiredAction = req.body.ctaDesiredAction || undefined;
      ctaLinkUrl = req.body.ctaLinkUrl || undefined;
      ctaPromoCode = req.body.ctaPromoCode || undefined;
      ctaLinkInBioRequirements = req.body.ctaLinkInBioRequirements || undefined;
      specialNotesInstructions = req.body.specialNotesInstructions || undefined;
      needAds = req.body.needAds || undefined;
      existingBrandGuidelinesUrls = req.body.existingBrandGuidelinesUrls || undefined;
      existingProductImage1Url = req.body.existingProductImage1Url || undefined;
      existingProductImage2Url = req.body.existingProductImage2Url || undefined;
      // Parse clear flags
      clearBrandGuidelines = req.body.clearBrandGuidelines === 'true';
      clearProductImage1 = req.body.clearProductImage1 === 'true';
      clearProductImage2 = req.body.clearProductImage2 === 'true';
    } else {
      // JSON body parsing (for Additional Details 2 which doesn't have file uploads)
      ({
        campaignId,
        socialMediaPlatform,
        contentFormat,
        postingStartDate,
        postingEndDate,
        mainMessage,
        keyPoints,
        toneAndStyle,
        referenceContent,
        hashtagsToUse,
        mentionsTagsRequired,
        creatorCompensation,
        ctaDesiredAction,
        ctaLinkUrl,
        ctaPromoCode,
        ctaLinkInBioRequirements,
        specialNotesInstructions,
        needAds,
      } = req.body);
    }

    if (!campaignId) {
      return res.status(400).json({ message: 'Campaign ID is required' });
    }

    // Get the campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        campaignBrief: true,
        campaignAdditionalDetails: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Handle file uploads for Additional Details 1
    let brandGuidelinesUrl: string | undefined;
    let productImage1Url: string | undefined;
    let productImage2Url: string | undefined;

    // Process brand guidelines upload
    if (clearBrandGuidelines) {
      // Explicitly cleared - set to null
      brandGuidelinesUrl = '';
    } else if (req.files && (req.files as any).brandGuidelines) {
      const brandGuidelinesFiles = Array.isArray((req.files as any).brandGuidelines)
        ? (req.files as any).brandGuidelines
        : [(req.files as any).brandGuidelines];

      const uploadedUrls: string[] = [];
      for (const file of brandGuidelinesFiles) {
        if (file && file.tempFilePath && file.name) {
          const url = await uploadAttachments({
            tempFilePath: file.tempFilePath,
            fileName: file.name,
            folderName: 'brandGuidelines',
          });
          uploadedUrls.push(url);
        }
      }

      // Combine with existing URLs if any
      if (existingBrandGuidelinesUrls) {
        const existingUrls = existingBrandGuidelinesUrls.split(',').filter(Boolean);
        brandGuidelinesUrl = [...existingUrls, ...uploadedUrls].join(',');
      } else {
        brandGuidelinesUrl = uploadedUrls.join(',');
      }
    } else if (existingBrandGuidelinesUrls !== undefined) {
      // Use existing URLs (could be empty string if cleared)
      brandGuidelinesUrl = existingBrandGuidelinesUrls || '';
    }

    // Process product image 1 upload
    if (clearProductImage1) {
      // Explicitly cleared - set to null
      productImage1Url = '';
    } else if (req.files && (req.files as any).productImage1) {
      const productImage1Files = Array.isArray((req.files as any).productImage1)
        ? (req.files as any).productImage1
        : [(req.files as any).productImage1];
      if (productImage1Files.length > 0 && productImage1Files[0].tempFilePath) {
        productImage1Url = await uploadCompanyLogo(productImage1Files[0].tempFilePath, productImage1Files[0].name);
      }
    } else if (existingProductImage1Url !== undefined) {
      // Use existing URL (could be empty string if cleared)
      productImage1Url = existingProductImage1Url || '';
    }

    // Process product image 2 upload
    if (clearProductImage2) {
      // Explicitly cleared - set to null
      productImage2Url = '';
    } else if (req.files && (req.files as any).productImage2) {
      const productImage2Files = Array.isArray((req.files as any).productImage2)
        ? (req.files as any).productImage2
        : [(req.files as any).productImage2];
      if (productImage2Files.length > 0 && productImage2Files[0].tempFilePath) {
        productImage2Url = await uploadCompanyLogo(productImage2Files[0].tempFilePath, productImage2Files[0].name);
      }
    } else if (existingProductImage2Url !== undefined) {
      // Use existing URL (could be empty string if cleared)
      productImage2Url = existingProductImage2Url || '';
    }

    // Build the update data for CampaignAdditionalDetails
    const additionalDetailsData: any = {};

    // Additional Details 1 fields
    if (contentFormat !== undefined) additionalDetailsData.contentFormat = contentFormat;
    if (mainMessage !== undefined) additionalDetailsData.mainMessage = mainMessage || null;
    if (keyPoints !== undefined) additionalDetailsData.keyPoints = keyPoints || null;
    if (toneAndStyle !== undefined) additionalDetailsData.toneAndStyle = toneAndStyle || null;
    if (brandGuidelinesUrl !== undefined) additionalDetailsData.brandGuidelinesUrl = brandGuidelinesUrl || null;
    if (referenceContent !== undefined) additionalDetailsData.referenceContent = referenceContent || null;
    if (productImage1Url !== undefined) additionalDetailsData.productImage1Url = productImage1Url || null;
    if (productImage2Url !== undefined) additionalDetailsData.productImage2Url = productImage2Url || null;

    // Additional Details 2 fields
    if (hashtagsToUse !== undefined) additionalDetailsData.hashtagsToUse = hashtagsToUse || null;
    if (mentionsTagsRequired !== undefined) additionalDetailsData.mentionsTagsRequired = mentionsTagsRequired || null;
    if (creatorCompensation !== undefined) additionalDetailsData.creatorCompensation = creatorCompensation || null;
    if (ctaDesiredAction !== undefined) additionalDetailsData.ctaDesiredAction = ctaDesiredAction || null;
    if (ctaLinkUrl !== undefined) additionalDetailsData.ctaLinkUrl = ctaLinkUrl || null;
    if (ctaPromoCode !== undefined) additionalDetailsData.ctaPromoCode = ctaPromoCode || null;
    if (ctaLinkInBioRequirements !== undefined) additionalDetailsData.ctaLinkInBioRequirements = ctaLinkInBioRequirements || null;
    if (specialNotesInstructions !== undefined) additionalDetailsData.specialNotesInstructions = specialNotesInstructions || null;
    if (needAds !== undefined) additionalDetailsData.needAds = needAds || null;

    // Upsert CampaignAdditionalDetails
    await prisma.campaignAdditionalDetails.upsert({
      where: { campaignId },
      update: additionalDetailsData,
      create: {
        campaignId,
        contentFormat: contentFormat || [],
        mainMessage: mainMessage || null,
        keyPoints: keyPoints || null,
        toneAndStyle: toneAndStyle || null,
        brandGuidelinesUrl: brandGuidelinesUrl || null,
        referenceContent: referenceContent || null,
        productImage1Url: productImage1Url || null,
        productImage2Url: productImage2Url || null,
        hashtagsToUse: hashtagsToUse || null,
        mentionsTagsRequired: mentionsTagsRequired || null,
        creatorCompensation: creatorCompensation || null,
        ctaDesiredAction: ctaDesiredAction || null,
        ctaLinkUrl: ctaLinkUrl || null,
        ctaPromoCode: ctaPromoCode || null,
        ctaLinkInBioRequirements: ctaLinkInBioRequirements || null,
        specialNotesInstructions: specialNotesInstructions || null,
        needAds: needAds || null,
      },
    });

    // Update CampaignBrief for socialMediaPlatform and posting dates
    if (socialMediaPlatform !== undefined || postingStartDate !== undefined || postingEndDate !== undefined) {
      const briefUpdateData: any = {};
      if (socialMediaPlatform !== undefined) briefUpdateData.socialMediaPlatform = socialMediaPlatform;
      if (postingStartDate !== undefined) briefUpdateData.postingStartDate = postingStartDate ? new Date(postingStartDate) : null;
      if (postingEndDate !== undefined) briefUpdateData.postingEndDate = postingEndDate ? new Date(postingEndDate) : null;

      if (campaign.campaignBrief) {
        await prisma.campaignBrief.update({
          where: { id: campaign.campaignBrief.id },
          data: briefUpdateData,
        });
      }
    }

    // Log the change
    if (adminId) {
      const campaignActivityMessage = `Campaign Details edited - [Additional Details]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaignId,
        },
      });

      const adminLogMessage = `Updated campaign additional details for campaign - ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Campaign additional details updated successfully' });
  } catch (error) {
    console.error('editCampaignAdditionalDetails error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to update campaign additional details', error });
  }
};

export const editCampaignTimeline = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { timeline, campaignStartDate, campaignEndDate } = req.body;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignTimeline: true,
        campaignBrief: true,
        campaignAdmin: true,
        campaignTasks: true,
        shortlisted: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    if (dayjs(campaignStartDate).isAfter(dayjs(), 'date') && campaign.shortlisted.length > 0) {
      return res
        .status(404)
        .json({ message: 'Failed to change campaign start date because there is existing shortlisted creators.' });
    }

    for (const [index, item] of timeline.entries()) {
      let submissionType;

      if (item.timeline_type.name === 'Agreement') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'AGREEMENT_FORM',
          },
        });
      } else if (item.timeline_type.name === 'First Draft') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'FIRST_DRAFT',
          },
        });
      } else if (item.timeline_type.name === 'Final Draft') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'FINAL_DRAFT',
          },
        });
      } else if (item.timeline_type.name === 'Posting') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'POSTING',
          },
        });
      }

      await prisma.campaignTimeline.upsert({
        where: {
          id: item?.id || item?.timeline_type.id,
        },
        update: {
          name: item?.timeline_type.name,
          for: item?.for,
          duration: parseInt(item.duration),
          startDate: dayjs(item?.startDate) as any,
          endDate: dayjs(item?.endDate) as any,
          campaignId: campaign?.id,
          order: index + 1,
          submissionTypeId: submissionType?.id,
        },
        create: {
          name: item?.timeline_type.name,
          for: item?.for,
          duration: parseInt(item.duration),
          startDate: dayjs(item?.startDate) as any,
          endDate: dayjs(item?.endDate) as any,
          campaignId: campaign?.id,
          order: index + 1,
          submissionTypeId: submissionType?.id,
        },
      });
    }

    // const data = await Promise.all(
    //   timeline.map(async (item: any, index: number) => {
    //     const result = await prisma.campaignTimeline.upsert({
    //       where: {
    //         id: item?.id || item?.timeline_type.id,
    //       },
    //       update: {
    //         name: item?.timeline_type.name,
    //         for: item?.for,
    //         duration: parseInt(item.duration),
    //         startDate: dayjs(item?.startDate) as any,
    //         endDate: dayjs(item?.endDate) as any,
    //         campaignId: campaign?.id,
    //         order: index + 1,
    //       },
    //       create: {
    //         name: item?.timeline_type.name,
    //         for: item?.for,
    //         duration: parseInt(item.duration),
    //         startDate: dayjs(item?.startDate) as any,
    //         endDate: dayjs(item?.endDate) as any,
    //         campaignId: campaign?.id,
    //         order: index + 1,
    //       },
    //       include: {
    //         campaignTasks: true,
    //       },
    //     });
    //     return result;
    //   }),
    // );

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        startDate: dayjs(campaignStartDate).format(),
        endDate: dayjs(campaignEndDate).format(),
      },
    });

    const adminId = req.session.userid;

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing timeline
      const campaignActivityMessage = `Campaign Details edited - [Timeline]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: id,
        },
      });

      const adminLogMessage = `Updated timeline for ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: 'Timeline updated successfully' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const changePitchStatus = async (req: Request, res: Response) => {
  const { status, pitchId, totalUGCVideos } = req.body;
  const adminId = req.session.userid;

  try {
    const existingPitch = await prisma.pitch.findUnique({
      where: {
        id: pitchId,
      },
      include: {
        campaign: {
          include: {
            campaignBrief: true,
          },
        },
        user: {
          include: {
            paymentForm: true,
            creator: true,
          },
        },
      },
    });

    if (!existingPitch) {
      return res.status(404).json({ message: 'Pitch not found.' });
    }

    if (!existingPitch.user.creator?.isFormCompleted)
      return res.status(404).json({ message: 'Payment form not completed.' });

    // Get admin info for logging
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = existingPitch.user.name || 'Creator';

    if (status === 'approved') {
      // Log admin activity for pitch approval
      const adminActivityMessage = `${adminName} approved ${creatorName}'s pitch`;
      await logChange(adminActivityMessage, existingPitch.campaignId, req);

      await prisma.$transaction(
        async (tx) => {
          const pitch = await prisma.pitch.update({
            where: {
              id: existingPitch.id,
            },
            data: {
              status: status,
              completedAt: status === 'approved' ? new Date() : null,
              approvedByAdminId: adminId,
            },
            include: {
              campaign: {
                include: {
                  campaignBrief: true,
                },
              },
            },
          });

          await tx.creatorAgreement.create({
            data: {
              userId: existingPitch.userId,
              campaignId: existingPitch.campaignId,
              agreementUrl: '',
            },
          });

          await tx.shortListedCreator.create({
            data: {
              userId: pitch?.userId,
              campaignId: pitch?.campaignId,
              ugcVideos: totalUGCVideos ? parseInt(totalUGCVideos) : null,
            },
          });

          const timelines = await tx.campaignTimeline.findMany({
            where: {
              AND: [
                {
                  campaignId: pitch?.campaignId,
                },
                {
                  for: 'creator',
                },
                {
                  name: {
                    not: 'Open For Pitch',
                  },
                },
              ],
            },
            include: {
              submissionType: true,
            },
            orderBy: {
              order: 'asc',
            },
          });

          const board = await tx.board.findUnique({
            where: {
              userId: existingPitch.userId,
            },
            include: {
              columns: true,
            },
          });

          if (!board) {
            throw new Error('Board not found.');
          }

          const columnToDo = await tx.columns.findFirst({
            where: {
              AND: [
                { boardId: board?.id },
                {
                  name: {
                    contains: 'To Do',
                  },
                },
              ],
            },
          });

          const columnInProgress = await tx.columns.findFirst({
            where: {
              AND: [
                { boardId: board?.id },
                {
                  name: {
                    contains: 'In Progress',
                  },
                },
              ],
            },
          });

          if (!columnToDo || !columnInProgress) {
            throw new Error('Column not found.');
          }

          type SubmissionWithRelations = Submission & {
            submissionType: SubmissionType;
          };

          const submissions: SubmissionWithRelations[] = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await tx.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: timeline.campaignId,
                  userId: pitch.userId as string,
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );

          const agreement = submissions.find((submission) => submission?.submissionType.type === 'AGREEMENT_FORM');
          const draft = submissions.find((submission) => submission?.submissionType.type === 'FIRST_DRAFT');
          const finalDraft = submissions.find((submission) => submission?.submissionType.type === 'FINAL_DRAFT');
          const posting = submissions.find((submission) => submission?.submissionType.type === 'POSTING');

          // Might change in the future
          const dependencies = [
            { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
            { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
            { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
          ];

          const filteredDependencies = dependencies.filter((dep) => dep.submissionId && dep.dependentSubmissionId);

          await tx.submissionDependency.createMany({
            data: filteredDependencies,
          });

          // Sending email
          const user = existingPitch.user;
          const campaignName = existingPitch?.campaign?.name;
          const campaignId = existingPitch?.campaign?.id;
          const creatorName = existingPitch?.user?.name;

          const image: any = pitch?.campaign?.campaignBrief?.images;

          shortlisted(user.email, campaignName, creatorName ?? 'Creator', campaignId, image[0]);

          const message = `Approved a sent pitch by  ${existingPitch.user.name} in campaign - ${pitch.campaign.name} `;
          logAdminChange(message, adminId, req);

          const data = await saveNotification({
            userId: pitch.userId,
            entityId: pitch.campaign.id as string,
            title: "✅ You're shorlisted!",
            message: `Congratulations! You've been shortlisted for the ${pitch.campaign.name} campaign.`,
            entity: 'Shortlist',
          });

          const socketId = clients.get(pitch.userId);

          if (socketId) {
            io.to(socketId).emit('notification', data);
            io.to(socketId).emit('shortlisted', {
              message: 'shortlisted',
              campaignId: pitch.campaign.id,
              campaignName: pitch.campaign.name,
            });
          }

          // Fetching admins for the campaign
          const admins = await tx.campaignAdmin.findMany({
            where: {
              campaignId: pitch.campaignId,
            },
            include: {
              admin: {
                include: {
                  user: true,
                },
              },
            },
          });

          // Send notifications to each admin
          for (const admin of admins) {
            const { title, message } = notificationPendingAgreement(pitch.campaign.name);
            const notification = await saveNotification({
              userId: admin.adminId,
              title: title,
              message: message,
              entity: 'Pitch',
              creatorId: pitch.userId,
              entityId: pitch.campaignId,
            });

            const adminSocketId = clients.get(admin.admin.userId);
            if (adminSocketId) {
              io.to(adminSocketId).emit('notification', notification);
            }
          }

          const campaign = await tx.campaign.findUnique({
            where: {
              id: pitch.campaignId,
            },
            include: {
              thread: true,
            },
          });

          if (!campaign || !campaign.thread) {
            return res.status(404).json({ message: 'Campaign or thread not found.' });
          }

          const isThreadExist = await tx.userThread.findFirst({
            where: {
              threadId: campaign.thread.id,
              userId: pitch.userId,
            },
          });

          if (!isThreadExist) {
            await tx.userThread.create({
              data: {
                threadId: campaign.thread.id,
                userId: pitch.userId,
              },
            });
          }
        },
        {
          timeout: 20000,
        },
      );

      // After approving a pitch (shortlist created), sync creators-campaign sheet (best-effort)
      try {
        await syncCreatorsCampaignSheetInternal();
      } catch (err) {
        console.log('Sheet sync failed (non-blocking):', err);
      }
    } else {
      // Log admin activity for pitch rejection
      const adminActivityMessage = `${adminName} rejected ${creatorName}'s pitch`;
      await logChange(adminActivityMessage, existingPitch.campaignId, req);

      const pitch = await prisma.pitch.update({
        where: {
          id: existingPitch.id,
        },
        data: {
          status: status,
        },
        include: {
          campaign: {
            include: {
              campaignBrief: true,
            },
          },
        },
      });

      const isExist = await prisma.shortListedCreator.findUnique({
        where: {
          userId_campaignId: {
            userId: pitch?.userId,
            campaignId: pitch?.campaignId,
          },
        },
      });

      if (isExist) {
        await prisma.shortListedCreator.delete({
          where: {
            userId_campaignId: {
              userId: pitch?.userId,
              campaignId: pitch?.campaignId,
            },
          },
        });
      }

      const submissions = await prisma.submission.findMany({
        where: {
          AND: [
            {
              userId: pitch.userId,
            },
            {
              campaignId: pitch.campaignId,
            },
          ],
        },
        include: {
          dependentOn: true,
          task: true,
        },
      });

      await prisma.submission.deleteMany({
        where: {
          AND: [
            {
              campaignId: pitch.campaignId,
            },
            {
              userId: pitch.userId,
            },
          ],
        },
      });

      const board = await prisma.board.findUnique({
        where: {
          userId: pitch?.userId,
        },
        include: {
          columns: {
            include: {
              task: true,
            },
          },
        },
      });

      if (board) {
        await prisma.task.deleteMany({
          where: {
            column: {
              boardId: board.id,
            },
          },
        });
      }

      // const toDoColumn = board.columns.find((item) => item.name === 'To Do');
      // const inProgressColumn = board.columns.find((item) => item.name === 'In Progress');

      //   for (const submission of submissions) {
      //     // const task = toDoColumn?.task.find((item) => item.submissionId === submission.id);

      //     await prisma.task.delete({
      //       where: {
      //         id: submission.task?.id,
      //       },
      //     });
      //   }
      // }

      const agreement = await prisma.creatorAgreement.findFirst({
        where: {
          AND: [{ userId: pitch.userId }, { campaignId: pitch.campaignId }],
        },
      });

      if (agreement) {
        await prisma.creatorAgreement.delete({
          where: {
            id: agreement.id,
          },
        });
      }
      const message = `Rejected a pitch sent by  ${existingPitch.user.name} for campaign - ${pitch.campaign.name} `;
      logAdminChange(message, adminId, req);
    }

    io.to(clients.get(existingPitch.userId)).emit('pitchUpdate');

    return res.status(200).json({ message: 'Successfully changed.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const uploadVideoTest = async (req: Request, res: Response) => {
  const { campaignId } = req.body;
  const { userid } = req.session;

  const fileName = `${userid}_${campaignId}_pitch.mp4`;

  try {
    if (!(req.files as any).pitchVideo) {
      return res.status(404).json({ message: 'Pitch Video not found.' });
    }

    const file = (req.files as any).pitchVideo;

    console.log(file);

    const filePath = `/tmp/${fileName}`;
    const compressedFilePath = `/tmp/${userid}_compressed.mp4`;

    await file.mv(filePath);

    const amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
    const channel = await amqp.createChannel();
    // await channel.assertQueue('pitch', { durable: true });

    // channel.sendToQueue(
    //   'pitch',
    //   Buffer.from(
    //     JSON.stringify({
    //       tempPath: filePath,
    //       outputPath: compressedFilePath,
    //       userId: userid,
    //       campaignId: campaignId,
    //       fileName: fileName,
    //     }),
    //   ),
    //   {
    //     persistent: true,
    //   },
    // );

    // await channel.close();
    // await amqp.close();

    try {
      await channel.assertQueue('pitch', { durable: true });

      channel.sendToQueue(
        'pitch',
        Buffer.from(
          JSON.stringify({
            tempPath: filePath,
            outputPath: compressedFilePath,
            userId: userid,
            campaignId: campaignId,
            fileName: fileName,
          }),
        ),
        { persistent: true },
      );

      return res.status(200).json({ message: 'Pitch video started processing' });
    } catch (queueError) {
      return res.status(500).json({ message: 'Failed to send message to queue.', error: queueError });
    } finally {
      await channel.close();
      await amqp.close();
    }

    return res.status(200).json({ message: 'Pitch video start processing' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const saveCampaign = async (req: Request, res: Response) => {
  const { campaignId } = req.body;
  const userid = req.session.userid;

  try {
    const bookmark = await prisma.bookMarkCampaign.create({
      data: {
        userId: userid as string,
        campaignId: campaignId as string,
      },
      include: {
        campaign: true,
      },
    });

    return res.status(200).json({ message: `Campaign ${bookmark.campaign?.name} has been bookmarked.` });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const unSaveCampaign = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const bookmark = await prisma.bookMarkCampaign.delete({
      where: {
        id: id as string,
      },
      include: {
        campaign: true,
      },
    });

    return res
      .status(200)
      .json({ message: `Campaign ${bookmark.campaign?.name} has been removed from your saved campaigns.` });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// export const createLogistics = async (req: Request, res: Response) => {
//   const {
//     data: { trackingNumber, itemName, courier, otherCourier },
//     campaignId,
//     creatorId: userId,
//   } = req.body;

//   const adminId = req.session.userid;

//   try {
//     const logistics = await prisma.logistics.create({
//       data: {
//         trackingNumber: trackingNumber,
//         itemName: itemName,
//         courier: courier === 'Other' ? otherCourier : courier,
//         campaignId: campaignId as string,
//         userId: userId as string,
//       },
//       include: {
//         user: true,
//         campaign: {
//           include: {
//             campaignBrief: true,
//           },
//         },
//       },
//     });

//     const image: any = logistics?.campaign?.campaignBrief?.images;

//     //Email for tracking logistics
//     tracking(
//       logistics.user.email,
//       logistics.campaign.name,
//       logistics.user.name ?? 'Creator',
//       logistics.trackingNumber,
//       logistics.campaignId,
//       image[0],
//     );

//     const { title, message } = notificationLogisticTracking(logistics.campaign.name, logistics.trackingNumber);

//     const notification = await saveNotification({
//       userId: userId,
//       title,
//       message,
//       // message: `Hi ${logistics.user.name}, your logistics details for the ${logistics.campaign.name} campaign are now available. Please check the logistics section for shipping information and tracking details. If you have any questions, don't hesitate to reach out!`,
//       entity: 'Logistic',
//     });

//     io.to(clients.get(userId)).emit('notification', notification);

//     const adminLogMessage = `Created New Logistic for campaign - ${logistics.campaign.name} `;
//     logAdminChange(adminLogMessage, adminId, req);

//     return res.status(200).json({ message: 'Logistics created successfully.' });
//   } catch (error) {
//     //console.log(error);
//     return res.status(400).json(error);
//   }
// };

// export const getLogisticById = async (req: Request, res: Response) => {
//   try {
//     const logistics = await prisma.logistics.findMany();
//     return res.status(200).json(logistics);
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// };

// export const updateStatusLogistic = async (req: Request, res: Response) => {
//   // eslint-disable-next-line prefer-const
//   let { logisticId, status } = req.body;
//   const adminId = req.session.userid;

//   if (status === 'Pending Delivery Confirmation') {
//     status = status.split(' ').join('_');
//   }
//   try {
//     const updated = await prisma.logistics.update({
//       where: {
//         id: logisticId,
//       },
//       data: {
//         status: status as LogisticStatus,
//       },
//       include: {
//         user: {
//           select: {
//             name: true,
//             email: true,
//           },
//         },
//         campaign: {
//           select: {
//             name: true,
//             campaignBrief: {
//               select: {
//                 images: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     const images: any = updated.campaign.campaignBrief?.images;

//     if (status === 'Product_has_been_received') {
//       // Call deliveryConfirmation function
//       deliveryConfirmation(
//         updated.user.email,
//         updated.campaign.name,
//         updated.user.name ?? 'Creator',
//         updated.campaignId,
//         images[0],
//       );

//       // Create and send the notification
//       const { title, message } = notificationLogisticDelivery(updated.campaign.name);
//       const notification = await saveNotification({
//         userId: updated.userId,
//         title,
//         message,
//         entity: 'Logistic',
//       });

//       io.to(clients.get(updated.userId)).emit('notification', notification);
//     }

//     // // deliveryConfirmation
//     // deliveryConfirmation(updated.user.email, updated.campaign.name, updated.user.name ?? 'Creator', updated.campaignId);

//     // const { title, message } = notificationLogisticDelivery(updated.campaign.name,);

//     // const notification = await saveNotification({
//     //   userId: updated.userId,
//     //   title,
//     //   message,
//     //   entity: 'Logistic',
//     // });

//     // io.to(clients.get(updated.userId)).emit('notification', notification);

//     const adminLogMessage = `Updated Logistic status for campaign - ${updated.campaign.name} `;
//     logAdminChange(adminLogMessage, adminId, req);

//     return res.status(200).json({ message: 'Logistic status updated successfully.' });
//   } catch (error) {
//     console.log(error);
//     return res.status(400).json(error);
//   }
// };

// export const receiveLogistic = async (req: Request, res: Response) => {
//   const { logisticId } = req.body;
//   try {
//     await prisma.logistics.update({
//       where: {
//         id: logisticId,
//       },
//       data: {
//         status: 'Product_has_been_received',
//       },
//     });

//     return res.status(200).json({ message: 'Item has been successfully delivered.' });
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// };

export const creatorAgreements = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  try {
    // First, ensure all approved shortlisted creators have agreement records
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        shortlisted: {
          include: {
            user: {
              include: {
                creator: true,
              },
            },
          },
        },
        pitch: {
          where: {
            status: {
              in: ['APPROVED', 'approved', 'AGREEMENT_PENDING', 'AGREEMENT_SUBMITTED'],
            },
          },
        },
      },
    });

    if (campaign) {
      // Get all approved user IDs from pitches and shortlisted creators
      const approvedUserIds = new Set<string>();

      // Add users from approved pitches
      campaign.pitch.forEach((p) => {
        if (p.userId) approvedUserIds.add(p.userId);
      });

      // Add users from shortlisted creators
      campaign.shortlisted.forEach((s) => {
        if (s.userId) approvedUserIds.add(s.userId);
      });

      // Get existing agreements for this campaign
      const existingAgreements = await prisma.creatorAgreement.findMany({
        where: { campaignId },
        select: { userId: true },
      });
      const existingUserIds = new Set(existingAgreements.map((a) => a.userId));

      // Create missing agreements
      const missingUserIds = [...approvedUserIds].filter((userId) => !existingUserIds.has(userId));

      if (missingUserIds.length > 0) {
        console.log(`Creating ${missingUserIds.length} missing agreements for campaign ${campaignId}`);
        await prisma.creatorAgreement.createMany({
          data: missingUserIds.map((userId) => ({
            userId,
            campaignId,
            agreementUrl: '',
          })),
          skipDuplicates: true,
        });
      }
    }

    // Now fetch all agreements including any newly created ones
    const agreements = await prisma.creatorAgreement.findMany({
      where: {
        campaignId: campaignId,
      },
      include: {
        user: {
          include: {
            creator: {
              include: {
                creditTier: {
                  select: {
                    id: true,
                    name: true,
                    creditsPerVideo: true,
                  },
                },
              },
            },
            paymentForm: true,
            shortlisted: {
              where: {
                campaignId: campaignId,
              },
              include: {
                creditTier: {
                  select: {
                    id: true,
                    name: true,
                    creditsPerVideo: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return res.status(200).json(agreements);
  } catch (error) {
    console.error('Error fetching/creating agreements:', error);
    return res.status(400).json(error);
  }
};

export const updateAmountAgreement = async (req: Request, res: Response) => {
  try {
    const { paymentAmount, currency, user, campaignId, id: agreementId, isNew, credits } = JSON.parse(req.body.data);

    console.log('Received update data:', { paymentAmount, currency, campaignId, agreementId, isNew, credits });

    const creator = await prisma.user.findUnique({
      where: {
        id: user?.id,
      },
      include: {
        paymentForm: true,
        creator: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const isCreditTierCampaign = campaign.isCreditTier === true;
    const isGuestCreator = creator.creator?.isGuest === true;

    // Get current agreement amount for comparison
    let currentAgreement = null;
    if (isNew) {
      // For V3: Find by userId and campaignId
      currentAgreement = await prisma.creatorAgreement.findUnique({
        where: {
          userId_campaignId: {
            userId: creator.id,
            campaignId: campaignId,
          },
        },
      });
    } else if (agreementId) {
      // For V2: Find by id
      currentAgreement = await prisma.creatorAgreement.findUnique({
        where: { id: agreementId },
      });
    }

    // Get current shortlisted creator for comparison
    const currentShortlisted = await prisma.shortListedCreator.findUnique({
      where: {
        userId_campaignId: {
          userId: creator.id,
          campaignId: campaignId,
        },
      },
    });

    // Get admin info for logging
    const adminId = req.session.userid;
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = creator.name || 'Creator';

    // Determine if credits/videos are being updated
    const newVideoCount = credits !== undefined && credits !== null ? Math.floor(Number(credits)) : null;
    const oldVideoCount = currentShortlisted?.ugcVideos || 0;
    const videosChanged = newVideoCount !== null && newVideoCount !== oldVideoCount;

    // For credit tier campaigns, calculate the tier info when videos are being set
    let creditPerVideo: number | null = null;
    let tierSnapshot: any = null;

    if (isCreditTierCampaign && !isGuestCreator && newVideoCount !== null && newVideoCount > 0) {
      const { calculateCreatorCreditCost } = require('@services/creditTierService');
      try {
        const creditCost = await calculateCreatorCreditCost(creator.id, newVideoCount);
        creditPerVideo = creditCost.creditPerVideo;
        tierSnapshot = creditCost.tier;
      } catch (error: any) {
        return res.status(400).json({
          message: error.message || 'Creator does not have valid follower data for credit tier pricing.',
          code: 'INVALID_TIER_DATA',
        });
      }
    }

    // Update shortlisted creator with amount, currency, and optionally videos/tier info
    await prisma.shortListedCreator.updateMany({
      where: {
        userId: creator.id,
        campaignId: campaignId,
      },
      data: {
        amount: parseInt(paymentAmount),
        currency: currency,
        ...(newVideoCount !== null && { ugcVideos: newVideoCount }),
        // Update tier info for credit tier campaigns
        ...(isCreditTierCampaign && creditPerVideo !== null && {
          creditPerVideo: creditPerVideo,
        }),
        ...(isCreditTierCampaign && tierSnapshot && {
          creditTierId: tierSnapshot.id,
        }),
      },
    });

    // If videos changed, also update the pitch record
    if (videosChanged && newVideoCount !== null) {
      await prisma.pitch.updateMany({
        where: {
          userId: creator.id,
          campaignId: campaignId,
        },
        data: {
          ugcCredits: newVideoCount,
        },
      });
    }

    let url = '';
    if (req?.files && (req?.files as any)?.agreementForm) {
      // Generate and upload new agreement file
      url = await uploadAgreementForm(
        (req?.files as any)?.agreementForm.tempFilePath,
        `${creator.id}-${campaign.name}-${Date.now()}.pdf`,
        'creatorAgreements',
      );
    }

    // Handle V3 agreement creation or V2 agreement update
    let updatedAgreement;

    if (isNew) {
      // For V3: Get the campaign's agreement template URL if no new file was uploaded
      let finalAgreementUrl = url;
      if (!url) {
        // Get the campaign with its agreement template
        const campaignWithTemplate = await prisma.campaign.findUnique({
          where: { id: campaignId },
          include: { agreementTemplate: true },
        });
        finalAgreementUrl = campaignWithTemplate?.agreementTemplate?.url || '';
      }

      // For V3: Create or update CreatorAgreement using upsert
      updatedAgreement = await prisma.creatorAgreement.upsert({
        where: {
          userId_campaignId: {
            userId: creator.id,
            campaignId: campaignId,
          },
        },
        update: {
          agreementUrl: finalAgreementUrl, // Use template URL if no new file
          amount: paymentAmount,
          currency: currency,
          isSent: false, // Not sent yet
        },
        create: {
          userId: creator.id,
          campaignId: campaignId,
          agreementUrl: finalAgreementUrl, // Use template URL if no new file
          amount: paymentAmount,
          currency: currency,
          isSent: false, // Not sent yet
        },
        include: {
          user: {
            include: {
              creator: true,
              paymentForm: true,
              shortlisted: {
                where: {
                  campaignId: campaignId,
                },
              },
            },
          },
        },
      });

      // Update pitch status to AGREEMENT_PENDING for V3
      await prisma.pitch.updateMany({
        where: {
          userId: creator.id,
          campaignId: campaignId,
          status: 'APPROVED',
        },
        data: {
          status: 'AGREEMENT_PENDING',
        },
      });
    } else {
      // For V2: Update existing CreatorAgreement
      updatedAgreement = await prisma.creatorAgreement.update({
        where: {
          id: agreementId,
        },
        data: {
          userId: creator.id,
          campaignId: campaignId,
          ...(url && { agreementUrl: url }), // Only update URL if new file was uploaded
          updatedAt: dayjs().format(),
          amount: paymentAmount,
          currency: currency,
        },
        include: {
          user: {
            include: {
              creator: true,
              paymentForm: true,
              shortlisted: {
                where: {
                  campaignId: campaignId,
                },
              },
            },
          },
        },
      });
    }

    // Log admin activity for amount change if amount was actually changed (not just set for the first time)
    if (currentAgreement && currentAgreement.amount && currentAgreement.amount !== paymentAmount) {
      const oldAmount = currentAgreement.amount;
      const newAmount = paymentAmount;
      const oldCurrency = currentAgreement.currency || 'MYR'; // Get the previous currency
      const newCurrency = currency; // Use the new currency from the request

      // Get currency symbol based on currency code
      const getCurrencySymbol = (currencyCode: string) => {
        switch (currencyCode) {
          case 'SGD':
          case 'AUD':
          case 'USD':
            return '$';
          case 'MYR':
            return 'RM';
          case 'JPY':
            return '¥';
          case 'IDR':
            return 'Rp';
          default:
            return 'RM'; // Default fallback
        }
      };

      const oldCurrencySymbol = getCurrencySymbol(oldCurrency);
      const newCurrencySymbol = getCurrencySymbol(newCurrency);
      const adminActivityMessage = `${adminName} changed the amount from ${oldCurrencySymbol}${oldAmount} to ${newCurrencySymbol}${newAmount} on the Agreement for ${creatorName}`;
      await logChange(adminActivityMessage, campaignId, req);
    }

    // Log admin activity for video count change
    if (videosChanged && newVideoCount !== null) {
      const adminActivityMessage = `${adminName} changed UGC videos from ${oldVideoCount} to ${newVideoCount} for ${creatorName}`;
      await logChange(adminActivityMessage, campaignId, req);
    }

    // For V4 campaigns with sent agreements, update submissions when video count changes
    const isV4Campaign = campaign.submissionVersion === 'v4';
    const agreementIsSent = currentAgreement?.isSent === true;

    if (isV4Campaign && agreementIsSent && videosChanged && newVideoCount !== null) {
      try {
        console.log(`📋 V4 agreement already sent, updating submissions for video count change`);
        const { updateV4Submissions } = require('../service/submissionV4Service');
        const result = await updateV4Submissions(creator.id, campaignId, newVideoCount);
        console.log(`✅ V4 submissions updated: ${result.deleted} deleted, ${result.created} created`);

        // Recalculate campaign credits
        if (campaign.campaignCredits) {
          const sentAgreements = await prisma.creatorAgreement.findMany({
            where: { campaignId, isSent: true },
            include: {
              user: {
                select: {
                  id: true,
                  creator: { select: { isGuest: true } },
                },
              },
            },
          });

          const sentNonGuestUserIds = sentAgreements
            .filter((a) => a.user?.creator?.isGuest !== true)
            .map((a) => a.userId);

          let totalAssigned = 0;
          if (sentNonGuestUserIds.length) {
            const shortlistedForCredits = await prisma.shortListedCreator.findMany({
              where: {
                campaignId,
                userId: { in: sentNonGuestUserIds },
                ugcVideos: { gt: 0 },
              },
              select: { ugcVideos: true },
            });
            totalAssigned = shortlistedForCredits.reduce((sum, item) => sum + Number(item.ugcVideos || 0), 0);
          }

          // V4 campaigns: update both utilized and pending
          // Non-v4: only update pending (credits utilized when posting approved)
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              creditsUtilized: totalAssigned,
              creditsPending: Math.max(0, Number(campaign.campaignCredits) - totalAssigned),
            },
          });
          console.log(`📊 Campaign credits recalculated: assigned=${totalAssigned}`);
        }
      } catch (error) {
        console.error('Error updating V4 submissions after credits change:', error);
        // Don't fail the whole request, just log the error
      }
    }

    console.log('Updated agreement:', updatedAgreement);

    return res.status(200).json({
      message: 'Agreement updated successfully',
      agreement: updatedAgreement,
    });
  } catch (error) {
    console.error('Error in updateAmountAgreement:', error);
    return res.status(500).json({ message: 'Error updating agreement', error: error.message });
  }
};

export const sendAgreement = async (req: Request, res: Response) => {
  const { user, id: agreementId, campaignId, isNew, credits } = req.body;

  const adminId = req.session.userid;

  try {
    const isUserExist = await prisma.user.findUnique({
      where: {
        id: user?.id,
      },
      include: {
        creator: true,
      },
    });

    if (!isUserExist) {
      return res.status(404).json({ message: 'Creator not exist' });
    }

    let agreement;

    if (isNew) {
      agreement = await prisma.creatorAgreement.findUnique({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: campaignId,
          },
        },
      });
    } else {
      agreement = await prisma.creatorAgreement.findUnique({
        where: {
          id: agreementId,
        },
      });
    }

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found.' });
    }

    const shortlistedCreator = await prisma.shortListedCreator.findUnique({
      where: {
        userId_campaignId: {
          userId: isUserExist.id,
          campaignId,
        },
      },
      include: {
        campaign: true,
        user: {
          include: {
            creator: true,
          },
        },
      },
    });

    if (!shortlistedCreator) {
      return res.status(404).json({ message: 'This creator is not shortlisted.' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      select: {
        name: true,
        agreementTemplate: true,
        campaignCredits: true,
        submissionVersion: true,
        isCreditTier: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const isV4Campaign = campaign.submissionVersion === 'v4';
    const isGuestCreator = shortlistedCreator.user?.creator?.isGuest === true;
    const isCreditTierCampaign = campaign.isCreditTier === true;

    let creditsToAssign: number | null = null;
    let creditPerVideo: number = 1; // Default for non-tier campaigns
    let tierSnapshot: any = null;
    let videoCount: number = 0;

    if (!isGuestCreator) {
      videoCount = Math.floor(Number(credits ?? shortlistedCreator.ugcVideos ?? 0));
      if (!Number.isFinite(videoCount) || videoCount <= 0) {
        return res.status(400).json({
          message: 'Number of videos must be provided before sending this agreement.',
        });
      }

      // Calculate credits based on campaign type
      if (isCreditTierCampaign) {
        // Credit Tier Campaign: Calculate credits based on creator's tier
        const { calculateCreatorCreditCost } = require('@services/creditTierService');
        try {
          const creditCost = await calculateCreatorCreditCost(isUserExist.id, videoCount);
          creditsToAssign = creditCost.totalCredits;
          creditPerVideo = creditCost.creditPerVideo;
          tierSnapshot = creditCost.tier;
        } catch (error: any) {
          return res.status(400).json({
            message: error.message || 'Creator does not have valid follower data for credit tier pricing.',
            code: 'INVALID_TIER_DATA',
          });
        }
      } else {
        // Non-tier Campaign: Use video count as credits (legacy 1:1 behavior)
        creditsToAssign = videoCount;
        creditPerVideo = 1;
      }

      if (campaign.campaignCredits) {
        const sentAgreementsBefore = await prisma.creatorAgreement.findMany({
          where: { campaignId, isSent: true },
          include: {
            user: {
              select: {
                id: true,
                creator: {
                  select: {
                    isGuest: true,
                  },
                },
              },
            },
          },
        });

        const sentNonGuestUserIdsBefore = sentAgreementsBefore
          .filter((agreementRecord) => agreementRecord.user?.creator?.isGuest !== true)
          .map((agreementRecord) => agreementRecord.userId);

        const otherUserIds = sentNonGuestUserIdsBefore.filter((id) => id !== isUserExist.id);

        // Calculate credits used by other creators
        let creditsUsedBefore = 0;
        if (otherUserIds.length) {
          if (isCreditTierCampaign) {
            // For tier campaigns, sum (ugcVideos * creditPerVideo) for each creator
            const otherShortlisted = await prisma.shortListedCreator.findMany({
              where: {
                campaignId,
                userId: { in: otherUserIds },
                ugcVideos: { gt: 0 },
              },
              select: {
                ugcVideos: true,
                creditPerVideo: true,
              },
            });
            creditsUsedBefore = otherShortlisted.reduce((sum, creator) => {
              const videos = creator.ugcVideos ?? 0;
              const perVideo = creator.creditPerVideo ?? 1;
              return sum + videos * perVideo;
            }, 0);
          } else {
            // For non-tier campaigns, sum ugcVideos directly
            const aggregate = await prisma.shortListedCreator.aggregate({
              where: {
                campaignId,
                userId: { in: otherUserIds },
                ugcVideos: { gt: 0 },
              },
              _sum: {
                ugcVideos: true,
              },
            });
            creditsUsedBefore = aggregate._sum.ugcVideos || 0;
          }
        }

        const remainingCredits = Number(campaign.campaignCredits) - creditsUsedBefore;
        if (creditsToAssign !== null && creditsToAssign > remainingCredits) {
          const errorResponse: any = {
            message: `Not enough credits available. Remaining: ${remainingCredits}, required: ${creditsToAssign}`,
          };
          // Add breakdown for tier campaigns
          if (isCreditTierCampaign) {
            errorResponse.breakdown = {
              videosRequested: videoCount,
              creditPerVideo: creditPerVideo,
              totalCredits: creditsToAssign,
              tierName: tierSnapshot?.name,
            };
          }
          return res.status(400).json(errorResponse);
        }
      }
    }

    if (isNew) {
      await prisma.creatorAgreement.update({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: campaignId,
          },
        },
        data: {
          isSent: true,
          completedAt: new Date(),
          approvedByAdminId: adminId,
        },
      });
    } else {
      await prisma.creatorAgreement.update({
        where: {
          id: agreement.id,
        },
        data: {
          isSent: true,
          completedAt: new Date(),
          approvedByAdminId: adminId,
        },
      });
    }

    // Update ShortListedCreator with video count and tier snapshot (for tier campaigns)
    await prisma.shortListedCreator.update({
      where: {
        id: shortlistedCreator.id,
      },
      data: {
        isAgreementReady: true,
        // Store video count (not total credits) - credits calculated from ugcVideos * creditPerVideo
        ...(videoCount > 0 && { ugcVideos: videoCount }),
        // Store tier snapshot for credit tier campaigns
        ...(isCreditTierCampaign && tierSnapshot && {
          creditPerVideo: creditPerVideo,
          creditTierId: tierSnapshot.id,
        }),
      },
    });
    shortlistedCreator.isAgreementReady = true;
    if (videoCount > 0) {
      shortlistedCreator.ugcVideos = videoCount;
      await prisma.pitch.updateMany({
        where: {
          userId: isUserExist.id,
          campaignId,
        },
        data: {
          ugcCredits: videoCount, // Store video count in pitch as well
        },
      });
    }

    if (campaign.campaignCredits) {
      const sentAgreements = await prisma.creatorAgreement.findMany({
        where: { campaignId, isSent: true },
        include: {
          user: {
            select: {
              id: true,
              creator: {
                select: {
                  isGuest: true,
                },
              },
            },
          },
        },
      });

      const sentNonGuestUserIds = sentAgreements
        .filter((agreementRecord) => agreementRecord.user?.creator?.isGuest !== true)
        .map((agreementRecord) => agreementRecord.userId);

      // Calculate total credits assigned based on campaign type
      let totalAssigned = 0;
      if (sentNonGuestUserIds.length) {
        const shortlistedForCredits = await prisma.shortListedCreator.findMany({
          where: {
            campaignId,
            userId: { in: sentNonGuestUserIds },
            ugcVideos: { gt: 0 },
          },
          select: {
            ugcVideos: true,
            creditPerVideo: true,
          },
        });

        if (isCreditTierCampaign) {
          // For tier campaigns: sum (ugcVideos * creditPerVideo)
          totalAssigned = shortlistedForCredits.reduce((sum, item) => {
            const videos = Number(item.ugcVideos || 0);
            const perVideo = Number(item.creditPerVideo || 1);
            return sum + videos * perVideo;
          }, 0);
        } else {
          // For non-tier campaigns: sum ugcVideos directly (1 credit = 1 video)
          totalAssigned = shortlistedForCredits.reduce((sum, item) => sum + Number(item.ugcVideos || 0), 0);
        }
      }

      // For v4 campaigns: mark credits as utilized immediately (submissions are created)
      // For non-v4 campaigns: only track assigned credits, will be utilized when posting approved
      if (isV4Campaign) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: {
            creditsUtilized: totalAssigned,
            creditsPending: Math.max(0, Number(campaign.campaignCredits) - totalAssigned),
          },
        });
      } else {
        // Non-v4: Only update pending (assigned but not yet utilized)
        await prisma.campaign.update({
          where: { id: campaignId },
          data: {
            creditsPending: Math.max(0, Number(campaign.campaignCredits) - totalAssigned),
          },
        });
      }
    }

    if (isV4Campaign && !isGuestCreator) {
      try {
        // Use updateV4Submissions which handles both initial creation and updates
        // It deletes existing VIDEO submissions and creates new ones based on current credits
        const { updateV4Submissions } = require('../service/submissionV4Service');
        const result = await updateV4Submissions(isUserExist.id, campaignId, shortlistedCreator.ugcVideos || 0);
        console.log(`✅ V4 submissions updated: ${result.deleted} deleted, ${result.created} created`);
      } catch (error) {
        console.error('Error creating V4 content submissions after agreement send:', error);
        return res.status(500).json({
          message: 'Agreement sent but failed to initialize V4 submissions. Please try again.',
        });
      }
    }

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = isUserExist.name || 'Creator';

    const adminActivityMessage = `${adminName} sent the Agreement to ${creatorName}`;
    await logChange(adminActivityMessage, campaignId, req);

    if (adminId) {
      const adminLogMessage = `Sent Agreement  to ${user.name} in campaign - ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    const { title, message } = notificationSignature(campaign.name);

    const notification = await saveNotification({
      userId: isUserExist.id,
      title: title,
      message: message,
      entity: 'Agreement',
      entityId: campaignId,
    });

    const socketId = clients.get(isUserExist.id);

    if (socketId) {
      io.to(socketId).emit('notification', notification);
      io.to(clients.get(isUserExist.id)).emit('agreementReady');
    }

    await prisma.campaignLog.create({
      data: {
        message: `Agreement has been sent to ${isUserExist.name || 'Creator'}`,
        adminId: adminId,
        campaignId: campaignId,
      },
    });

    return res.status(200).json({ message: 'Agreement has been sent.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignImages = async (req: Request, res: Response) => {
  const { campaignImages, campaignId } = req.body;
  const newImages: string[] = [];
  const adminId = req.session.userid;

  try {
    const newCampaignImages = (req.files as any)?.campaignImages;

    const campaign = await prisma.campaignBrief.findFirst({
      where: {
        campaignId: campaignId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign Not Found.' });
    }

    if (!newCampaignImages && !campaignImages) {
      return res.status(404).json({ message: "Campaign image can't be empty." });
    }

    if (newCampaignImages) {
      if (newCampaignImages?.length) {
        for (const item of newCampaignImages as any) {
          const url = await uploadImage(item.tempFilePath, item.name, 'campaign');
          newImages.push(url);
        }
      } else {
        const images = newCampaignImages;
        const url = await uploadImage(images.tempFilePath, images.name, 'campaign');
        newImages.push(url);
      }

      if (campaignImages) {
        newImages.push(campaignImages);
      }

      // const adminLogMessage = `Added A New Campaign Image To - ${campaign.title}`;
      // logAdminChange(adminLogMessage, adminId, req);

      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign?.campaignId,
        },
        data: {
          images: [newImages].flat(),
        },
      });
    } else {
      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign?.campaignId,
        },
        data: {
          images: [campaignImages].flat(),
        },
      });
    }

    if (adminId) {
      const adminLogMessage = `Updated Campaign Images In ${campaign.title} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Image are updated.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const draftPitch = async (req: Request, res: Response) => {
  const { content, userId, campaignId, followerCount } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const pitch = await prisma.pitch.findFirst({
      where: {
        AND: [{ userId: user?.id }, { campaignId: campaign?.id }],
      },
    });

    if (!pitch) {
      await prisma.pitch.create({
        data: {
          userId: user?.id,
          campaignId: campaign?.id,
          content: content,
          status: 'draft',
          type: 'text',
          followerCount: followerCount || null,
          outreachStatus: 'INTERESTED',
        },
      });
    } else {
      await prisma.pitch.update({
        where: {
          id: pitch?.id,
        },
        data: {
          content: content,
          followerCount: followerCount || pitch.followerCount,
        },
      });
    }

    // Update Creator.manualFollowerCount if no media kit exists
    if (followerCount) {
      const creatorWithMediaKit = await prisma.creator.findUnique({
        where: { userId: user?.id },
        select: {
          instagramUser: { select: { id: true } },
          tiktokUser: { select: { id: true } },
        },
      });

      const hasMediaKit = !!(creatorWithMediaKit?.instagramUser || creatorWithMediaKit?.tiktokUser);

      if (!hasMediaKit) {
        const followerCountInt = parseInt(followerCount, 10);
        if (!isNaN(followerCountInt) && followerCountInt > 0) {
          await prisma.creator.update({
            where: { userId: user?.id },
            data: { manualFollowerCount: followerCountInt },
          });

          // Recalculate and update creator's credit tier based on new follower count
          const { updateCreatorTier } = require('@services/creditTierService');
          await updateCreatorTier(user?.id as string);
        }
      }
    }

    return res.status(200).json({ message: 'Pitch has been saved as draft.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const removePitchVideo = async (req: Request, res: Response) => {
  const { userId, campaignId } = req.body;

  try {
    const fileName = `${userId}_${campaignId}_pitch.mp4`;

    await deleteContent({ folderName: 'pitchVideo', fileName: fileName });

    return res.status(200).json({ message: 'Pitch video is removed.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignAdmin = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  const {
    data: { admins },
  } = req.body;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignAdmin: true,
        thread: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const adjustedAdmins: any = await Promise.all(
      admins.map(async (admin: any) => {
        const data = await prisma.admin.findFirst({
          where: {
            userId: admin.id,
          },
          include: {
            user: {
              select: {
                id: true,
                role: true,
              },
            },
            role: {
              select: {
                name: true,
              },
            },
          },
        });
        return data;
      }),
    );

    const existingAdmins = await prisma.campaignAdmin.findMany({
      where: {
        campaignId: campaign.id,
      },
      select: {
        admin: {
          select: { userId: true },
        },
      },
    });

    const filteredExistingAdmins = existingAdmins.map((item) => item?.admin?.userId); //map to admin id

    const newAdmins: any[] = admins.filter((admin: { id: string }) => !filteredExistingAdmins.includes(admin.id));

    const removedAdmins: any[] = existingAdmins.filter((admin) =>
      admins.every((item: any) => item.id !== admin.admin.userId),
    );

    // Check if any new admin being added is a client user
    const hasClientAdmin = adjustedAdmins.some((admin: any) => {
      return admin?.user?.role === 'client' || admin?.role?.name === 'Client';
    });

    await prisma.campaignAdmin.deleteMany({
      where: {
        campaignId: campaign?.id,
      },
    });

    // Update campaign with new admins and set submissionVersion to v4 if client is added
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: campaign?.id,
      },
      data: {
        campaignAdmin: {
          create: adjustedAdmins.map((admin: any) => ({
            adminId: admin.userId,
          })),
        },
        ...(hasClientAdmin && { submissionVersion: 'v4' }),
      },
    });

    // For client users being added as campaign admins, also add them to CampaignClient
    // This ensures they are tracked in both models for v4 campaigns
    for (const admin of adjustedAdmins) {
      const isClientUser = admin?.user?.role === 'client' || admin?.role?.name === 'Client';

      if (isClientUser && admin?.userId) {
        try {
          // Find the client record for this user
          const clientRecord = await prisma.client.findUnique({
            where: { userId: admin.userId },
          });

          if (clientRecord) {
            // Check if already in CampaignClient
            const existingCampaignClient = await prisma.campaignClient.findUnique({
              where: {
                clientId_campaignId: {
                  clientId: clientRecord.id,
                  campaignId: campaign.id,
                },
              },
            });

            if (!existingCampaignClient) {
              await prisma.campaignClient.create({
                data: {
                  clientId: clientRecord.id,
                  campaignId: campaign.id,
                  role: 'owner',
                },
              });
              console.log(`Added client ${clientRecord.id} to CampaignClient for campaign ${campaign.id}`);
            }
          }
        } catch (error) {
          console.error(`Error adding client user ${admin.userId} to CampaignClient:`, error);
          // Don't fail the edit if CampaignClient integration fails
        }
      }
    }

    if (newAdmins.length > 0) {
      for (const admin of newAdmins) {
        try {
          if (campaign.thread?.id) {
            await prisma.userThread.create({
              data: {
                userId: admin.id,
                threadId: campaign.thread.id,
              },
            });
          }
        } catch (error) {
          console.error(`Error adding user ${admin.id} to thread:`, error);
          // Don't fail if thread operation fails
        }
      }
    }

    if (removedAdmins.length > 0) {
      // Remove from UserThread
      for (const admin of removedAdmins) {
        try {
          if (campaign.thread?.id) {
            // Check if the UserThread exists before trying to delete
            const existingUserThread = await prisma.userThread.findUnique({
              where: {
                userId_threadId: {
                  userId: admin.admin.userId,
                  threadId: campaign.thread.id,
                },
              },
            });

            if (existingUserThread) {
              await prisma.userThread.delete({
                where: {
                  userId_threadId: {
                    userId: admin.admin.userId,
                    threadId: campaign.thread.id,
                  },
                },
              });
            }
          }
        } catch (error) {
          console.error(`Error removing user ${admin.admin.userId} from thread:`, error);
          // Don't fail if thread operation fails
        }
      }

      // For client users being removed as campaign admins, also remove them from CampaignClient
      for (const removedAdmin of removedAdmins) {
        try {
          const removedUserId = removedAdmin.admin.userId;

          // Check if this removed admin is a client user
          const removedUser = await prisma.user.findUnique({
            where: { id: removedUserId },
            include: { client: true },
          });

          if (removedUser?.role === 'client' && removedUser?.client?.id) {
            // Remove from CampaignClient
            const existingCampaignClient = await prisma.campaignClient.findUnique({
              where: {
                clientId_campaignId: {
                  clientId: removedUser.client.id,
                  campaignId: campaign.id,
                },
              },
            });

            if (existingCampaignClient) {
              await prisma.campaignClient.delete({
                where: {
                  clientId_campaignId: {
                    clientId: removedUser.client.id,
                    campaignId: campaign.id,
                  },
                },
              });
              console.log(`Removed client ${removedUser.client.id} from CampaignClient for campaign ${campaign.id}`);
            }
          }
        } catch (error) {
          console.error(`Error removing client user from CampaignClient:`, error);
          // Don't fail the edit if CampaignClient removal fails
        }
      }
    }

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing campaign manager
      const campaignActivityMessage = `Campaign Details edited - [Campaign Manager]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaign.id,
        },
      });

      const adminLogMessage = hasClientAdmin
        ? `Updated Admins list in ${campaign.name} and converted to V4 (client added)`
        : `Updated Admins list in ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

// Add client managers to a campaign and flip origin to CLIENT (V3)
export const addClientManagers = async (req: Request, res: Response) => {
  const adminId = req.session.userid;
  const { campaignId, clientManagers } = req.body as {
    campaignId: string;
    clientManagers: ({ id?: string; email?: string } | string)[];
  };

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    // Resolve client manager userIds
    const userIds: string[] = [];
    for (const cm of clientManagers || []) {
      const id = typeof cm === 'string' ? cm : cm?.id || '';
      if (id) {
        userIds.push(id);
        continue;
      }
      const email = typeof cm !== 'string' ? cm?.email : undefined;
      if (email) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) userIds.push(user.id);
      }
    }

    // Create campaignAdmin entries for these users
    for (const uid of userIds) {
      const exists = await prisma.campaignAdmin.findUnique({
        where: { adminId_campaignId: { adminId: uid, campaignId } },
      });
      if (!exists) {
        await prisma.campaignAdmin.create({ data: { adminId: uid, campaignId } });
      }
    }

    // Flip origin to CLIENT for v3 flow
    await prisma.campaign.update({ where: { id: campaignId }, data: { origin: 'CLIENT' } });

    // Add child accounts to the campaign for each client manager
    for (const userId of userIds) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { client: true },
        });

        if (user?.client) {
          const { addChildAccountsToCampaign } = await import('./childAccountController.js');
          await addChildAccountsToCampaign(user.client.id, campaignId);
        }
      } catch (error) {
        console.error('Error adding child accounts to campaign for user:', userId, error);
        // Don't fail the request if child account integration fails
      }
    }

    if (adminId) {
      const adminLogMessage = `Added ${userIds.length} client manager(s) and converted campaign to V3`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Client managers added and campaign converted to V3.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignAttachments = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { otherAttachments: currentAttachments } = req.body;
  const otherAttachments: string[] = [];
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignAdmin: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    if (req.files && req.files.otherAttachments) {
      const attachments: any = (req.files as any).otherAttachments as [];

      if (attachments.length) {
        for (const item of attachments as any) {
          const url: string = await uploadAttachments({
            tempFilePath: item.tempFilePath,
            fileName: item.name,
            folderName: 'otherAttachments',
          });
          otherAttachments.push(url);
        }
      } else {
        const url: string = await uploadAttachments({
          tempFilePath: attachments.tempFilePath,
          fileName: attachments.name,
          folderName: 'otherAttachments',
        });
        otherAttachments.push(url);
      }
    }

    if (currentAttachments) {
      if (Array.isArray(currentAttachments)) {
        otherAttachments.push(...currentAttachments);
      } else {
        otherAttachments.push(currentAttachments);
      }
    }

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        otherAttachments: otherAttachments,
      },
    });

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing other attachment
      const campaignActivityMessage = `Campaign Details edited - [Other Attachment]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaign.id,
        },
      });

      const adminLogMessage = `Updated Other Attachments in - ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createNewSpreadSheets = async (req: Request, res: Response) => {
  const { campaignId } = req.body;
  console.log(campaignId);
  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const url = await createNewSpreadSheet({ title: campaign.name });

    const data = await prisma.campaign.update({
      where: {
        id: campaign.id,
      },
      data: {
        spreadSheetURL: url,
      },
    });

    return res.status(200).json({ message: 'Spreadsheet is created', url: data.spreadSheetURL });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignReference = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { referencesLinks } = req.body;
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignAdmin: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        referencesLinks: referencesLinks?.map((link: any) => link.value) || [],
      },
    });

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing reference
      const campaignActivityMessage = `Campaign Details edited - [Reference]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaign.id,
        },
      });

      const Message = `Updated reference links in campaign - ${campaign.name}`;
      logAdminChange(Message, adminId, req);
    }
    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const linkNewAgreement = async (req: Request, res: Response) => {
  const { template, campaignId } = req.body;
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    await prisma.campaign.update({
      where: {
        id: campaign.id,
      },
      data: {
        agreementTemplate: {
          connect: { id: template?.id },
        },
      },
    });

    // Get admin info for logging
    if (adminId) {
      // Log campaign activity for editing agreement
      const campaignActivityMessage = `Campaign Details edited - [Agreement]`;
      await prisma.campaignLog.create({
        data: {
          message: campaignActivityMessage,
          adminId: adminId,
          campaignId: campaign.id,
        },
      });

      const adminLogMessage = `Linked/Updated Agreement to - "${campaign.name}" `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Successfully linked new agreeement' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const removeCreatorFromCampaign = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Attempting to remove creator ${creatorId} from campaign ${campaignId}`);

    const user = await prisma.user.findUnique({
      where: {
        id: creatorId,
      },
      include: {
        creator: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'No user found.' });

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        thread: true,
        pitch: {
          where: {
            userId: creatorId,
          },
        },
      },
    });

    if (!campaign) return res.status(404).json({ message: 'No campaign found.' });

    const threadId = campaign?.thread?.id;
    console.log(`Found campaign: ${campaign.name}, thread ID: ${threadId}`);
    console.log(`Creator has ${campaign.pitch?.length || 0} pitches for this campaign`);

    await prisma.$transaction(async (tx) => {
      // First check if creator is shortlisted
      const shortlistedCreator = await tx.shortListedCreator.findFirst({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });

      console.log(`Shortlisted creator record found: ${!!shortlistedCreator}`);

      // If creator is shortlisted, handle that flow
      if (shortlistedCreator) {
        console.log(`Processing shortlisted creator: ${shortlistedCreator.id}`);

        if (shortlistedCreator.ugcVideos) {
          await tx.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              creditsUtilized: {
                decrement: shortlistedCreator.ugcVideos!,
              },
              creditsPending: {
                increment: shortlistedCreator.ugcVideos!,
              },
            },
          });
          console.log(`Updated campaign credits for shortlisted creator`);
        }

        // Delete the shortlisted creator record
        await tx.shortListedCreator.delete({
          where: {
            id: shortlistedCreator.id,
          },
        });
        console.log(`Deleted shortlisted creator record`);
      }

      // Always delete these records regardless of shortlist status
      console.log(`Deleting creator's content and submissions for campaign`);

      // Delete videos
      const deletedVideos = await tx.video.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedVideos.count} videos`);

      // Delete photos
      const deletedPhotos = await tx.photo.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedPhotos.count} photos`);

      // Delete raw footage
      const deletedFootage = await tx.rawFootage.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedFootage.count} raw footage items`);

      // Delete submissions
      const deletedSubmissions = await tx.submission.deleteMany({
        where: {
          AND: [
            {
              userId: user.id,
            },
            {
              campaignId: campaign.id,
            },
          ],
        },
      });
      console.log(`Deleted ${deletedSubmissions.count} submissions`);

      // Delete pitches
      const deletedPitches = await tx.pitch.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedPitches.count} pitches`);

      // Delete user thread if it exists
      if (threadId) {
        try {
          await tx.userThread.delete({
            where: {
              userId_threadId: {
                userId: user.id,
                threadId: threadId!,
              },
            },
          });
          console.log(`Deleted user thread for creator`);
        } catch (error) {
          console.log('Error deleting user thread:', error);
          // Continue with other deletions even if this one fails
        }
      }

      // Delete creator agreement if it exists
      try {
        await tx.creatorAgreement.delete({
          where: {
            userId_campaignId: {
              userId: user.id,
              campaignId: campaign.id,
            },
          },
        });
        console.log(`Deleted creator agreement`);
      } catch (error) {
        console.log('Error deleting creator agreement:', error);
        // Continue with other deletions
      }

      // Delete invoice if it exists
      try {
        const invoice = await tx.invoice.findFirst({
          where: {
            AND: [
              {
                creatorId: user.id,
              },
              {
                campaignId: campaign.id,
              },
            ],
          },
          include: {
            creator: {
              include: {
                user: true,
              },
            },
          },
        });

        if (invoice) {
          await tx.invoice.delete({
            where: {
              id: invoice.id,
            },
          });
        }
      } catch (error) {
        console.log('Error deleting invoice:', error);
      }

      // If this is a guest creator, delete the creator and user from the database
      const isGuestUser = user.status === 'guest';
      const isGuestCreator = user.creator?.isGuest === true;

      if (isGuestUser && isGuestCreator) {
        console.log(`Deleting guest user ${user.name} (${user.id}) from database`);

        // For guest users, we need to delete ALL records referencing this user
        // (not just for this campaign) to avoid foreign key constraint violations

        // Delete all remaining pitches for this user (from any campaign)
        const deletedAllPitches = await tx.pitch.deleteMany({
          where: { userId: user.id },
        });
        console.log(`Deleted ${deletedAllPitches.count} total pitches for guest user`);

        // Delete all remaining submissions for this user (from any campaign)
        const deletedAllSubmissions = await tx.submission.deleteMany({
          where: { userId: user.id },
        });
        console.log(`Deleted ${deletedAllSubmissions.count} total submissions for guest user`);

        // Delete all shortlisted records for this user
        const deletedAllShortlisted = await tx.shortListedCreator.deleteMany({
          where: { userId: user.id },
        });
        console.log(`Deleted ${deletedAllShortlisted.count} total shortlisted records for guest user`);

        // Delete all creator agreements for this user
        const deletedAllAgreements = await tx.creatorAgreement.deleteMany({
          where: { userId: user.id },
        });
        console.log(`Deleted ${deletedAllAgreements.count} total agreements for guest user`);

        // Delete all notifications for this user
        const deletedAllNotifications = await tx.userNotification.deleteMany({
          where: { userId: user.id },
        });
        console.log(`Deleted ${deletedAllNotifications.count} total notifications for guest user`);

        if (user.creator) {
          await tx.creator.delete({
            where: {
              id: user.creator.id,
            },
          });
          console.log(`Deleted Creator record`);
        }

        await tx.user.delete({
          where: {
            id: user.id,
          },
        });
        console.log(`Successfully deleted guest user from User table`);
      }
    });

    const adminLogMessage = `Withdrew Creator "${user.name}" From - ${campaign.name} `;
    logAdminChange(adminLogMessage, adminId, req);

    // Log the creator removal in campaign logs
    await prisma.campaignLog.create({
      data: {
        message: `${user.name || 'Creator'} has been removed from the campaign`,
        adminId: adminId,
        campaignId: campaign.id,
      },
    });

    return res.status(200).json({ message: 'Creator has been successfully withdrawn from the campaign.' });
  } catch (error) {
    console.log('Error removing creator from campaign:', error);
    return res.status(400).json({
      message: 'Failed to remove creator from campaign.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getCampaignsTotal = async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.count();
    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const resendAgreement = async (req: Request, res: Response) => {
  const { userId, campaignId } = req.body;
  const adminId = req.session.userid;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        creator: true,
      },
    });

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        name: true,
        agreementTemplate: true,
      },
    });

    if (!user || !campaign) {
      return res.status(404).json({ message: 'User or campaign not found.' });
    }

    // Find the agreement
    const agreement = await prisma.creatorAgreement.findFirst({
      where: {
        userId: userId,
        campaignId: campaignId,
      },
    });

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found.' });
    }

    // Update the agreement status for resend
    await prisma.creatorAgreement.update({
      where: {
        id: agreement.id,
      },
      data: {
        isSent: true,
        completedAt: new Date(),
        approvedByAdminId: adminId,
      },
    });

    // Update shortlisted creator table
    const shortlistedCreator = await prisma.shortListedCreator.findFirst({
      where: {
        userId: userId,
        campaignId: campaignId,
      },
    });

    if (shortlistedCreator) {
      await prisma.shortListedCreator.update({
        where: {
          id: shortlistedCreator.id,
        },
        data: {
          isAgreementReady: true,
        },
      });
    }

    // Get admin info for logging
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = user.name || 'Creator';

    // Log admin activity for resending agreement
    const adminActivityMessage = `${adminName} resent the Agreement to ${creatorName}`;
    await logChange(adminActivityMessage, campaignId, req);

    if (adminId) {
      const adminLogMessage = `Resent Agreement to ${user.name} in campaign - ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    const { title, message } = notificationSignature(campaign.name);

    const notification = await saveNotification({
      userId: userId,
      title: title,
      message: message,
      entity: 'Agreement',
      entityId: campaignId,
    });

    const socketId = clients.get(userId);

    if (socketId) {
      io.to(socketId).emit('notification', notification);
      io.to(clients.get(userId)).emit('agreementReady');
    }

    return res.status(200).json({ message: 'Agreement resent successfully.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// V3: Creator submits agreement for a client-origin campaign
export const submitAgreementV3 = async (req: Request, res: Response) => {
  const { pitchId } = req.params as { pitchId: string };
  const { agreementUrl } = req.body as { agreementUrl?: string };
  const userId = req.session.userid;

  try {
    console.log('[submitAgreementV3] start', { pitchId, userId, hasAgreementUrl: !!agreementUrl });
    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: { campaign: true },
    });

    if (!pitch) {
      console.log('[submitAgreementV3] pitch not found');
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Allow if current user is the pitch owner, or an admin/superadmin (to help testing)
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isOwner = pitch.userId === userId;
    const isPrivileged = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';
    console.log('[submitAgreementV3] auth', { isOwner, isPrivileged, currentUserRole: currentUser?.role });
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    if (!pitch.campaignId) return res.status(400).json({ message: 'Campaign not found for pitch' });

    // Upsert creator agreement for V3
    console.log('[submitAgreementV3] upserting agreement', { campaignId: pitch.campaignId, pitchUserId: pitch.userId });
    await prisma.creatorAgreement.upsert({
      where: {
        userId_campaignId: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
        },
      },
      update: {
        agreementUrl: agreementUrl || undefined,
        isSent: true,
        completedAt: new Date(),
      },
      create: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
        agreementUrl: agreementUrl || '',
        isSent: true,
        completedAt: new Date(),
      },
    });

    // Mark pitch as AGREEMENT_SUBMITTED for V3 flow
    console.log('[submitAgreementV3] updating pitch status to AGREEMENT_SUBMITTED');
    const updatedPitch = await prisma.pitch.update({
      where: { id: pitch.id },
      data: { status: 'AGREEMENT_SUBMITTED' },
    });

    // Notify campaign admins
    const admins = await prisma.campaignAdmin.findMany({
      where: { campaignId: pitch.campaignId as string },
      include: { admin: { include: { user: true } } },
    });
    const submitter = await prisma.user.findUnique({ where: { id: pitch.userId } });
    const campaignName = pitch.campaign?.name || '';

    // Mark shortlisted row as agreement ready so admin UI reflects new state
    const shortlisted = await prisma.shortListedCreator.findFirst({
      where: { userId: pitch.userId, campaignId: pitch.campaignId as string },
    });
    if (shortlisted) {
      await prisma.shortListedCreator.update({
        where: { id: shortlisted.id },
        data: { isAgreementReady: true },
      });
    }
    for (const a of admins) {
      const notification = await saveNotification({
        userId: a.adminId,
        title: 'Agreement Submitted',
        message: `${submitter?.name || 'Creator'} submitted the agreement for ${campaignName}.`,
        entity: 'Agreement',
        entityId: pitch.campaignId as string,
      });
      const socketId = clients.get(a.admin.userId);
      if (socketId) {
        io.to(socketId).emit('notification', notification);
        io.to(socketId).emit('agreementReady');
        io.to(socketId).emit('pitchUpdate');
      }
    }

    // Log campaign activity for agreement submission
    await prisma.campaignLog.create({
      data: {
        message: `${submitter?.name || 'Creator'} submitted agreement`,
        adminId: userId,
        campaignId: pitch.campaignId as string,
      },
    });

    console.log('[submitAgreementV3] success');
    return res.status(200).json({ message: 'Agreement submitted', pitch: updatedPitch });
  } catch (error) {
    console.error('submitAgreementV3 error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to submit agreement' });
  }
};

// Shortlist creators for a campaign
export const shortlistCreator = async (req: Request, res: Response) => {
  const { newVal: creators, campaignId } = req.body;

  const adminId = req.session.userid;

  try {
    await prisma.$transaction(
      async (tx) => {
        try {
          const campaign = await tx.campaign.findUnique({
            where: { id: campaignId },
            include: { thread: true, campaignBrief: true },
          });

          if (!campaign) throw new Error('Campaign not found.');

          const timelines = await tx.campaignTimeline.findMany({
            where: {
              campaignId: campaign.id,
              for: 'creator',
              name: { not: 'Open For Pitch' },
            },
            include: { submissionType: true },
            orderBy: { order: 'asc' },
          });

          // Fetch all creators in one query
          const creatorIds = creators.map((c: any) => c.id);

          const creatorData = await tx.user.findMany({
            where: { id: { in: creatorIds } },
            include: { creator: true, paymentForm: true },
          });

          // Bulk create agreements
          await tx.creatorAgreement.createMany({
            data: creatorData.map((creator) => ({
              userId: creator.id,
              campaignId: campaign.id,
              agreementUrl: '',
            })),
          });

          // Bulk create shortlisted creators
          const shortlistedCreators = await tx.shortListedCreator.createMany({
            data: creatorData.map((creator) => ({
              userId: creator.id,
              campaignId,
              amount: 0,
              currency: 'MYR',
            })),
          });

          // Fetch all boards in one query
          const boards = await tx.board.findMany({
            where: { userId: { in: creatorIds } },
            include: { columns: true },
          });

          for (const creator of creatorData) {
            const board = boards.find((b) => b.userId === creator.id);
            if (!board) throw new Error(`Board not found for user ${creator.id}`);

            const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
            const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));
            if (!columnToDo || !columnInProgress) throw new Error('Columns not found.');

            type SubmissionWithRelations = Submission & {
              submissionType: SubmissionType;
            };

            const submissions: any[] = await Promise.all(
              timelines.map(async (timeline, index) => {
                return await tx.submission.create({
                  data: {
                    dueDate: timeline.endDate,
                    campaignId: campaign.id,
                    userId: creator.id as string,
                    // status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
                    status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                    submissionTypeId: timeline.submissionTypeId as string,
                    task: {
                      create: {
                        name: timeline.name,
                        position: index,
                        columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                        priority: '',
                        status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                      },
                    },
                  },
                  include: {
                    submissionType: true,
                  },
                });
              }),
            );

            // Create dependencies
            const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
            const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
            const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
            const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

            const dependencies = [
              { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
              { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
              { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
            ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

            if (dependencies.length) await tx.submissionDependency.createMany({ data: dependencies });
          }

          // Notify admins & creators
          const admins = await tx.campaignAdmin.findMany({
            where: { campaignId },
            include: { admin: { include: { user: true } } },
          });

          for (const creator of creatorData) {
            const notification = await saveNotification({
              userId: creator.id,
              entityId: campaignId,
              message: `Congratulations! You've been shortlisted for the ${campaign.name} campaign.`,
              entity: 'Shortlist',
            });

            const image: any = campaign.campaignBrief?.images;
            shortlisted(creator.email, campaign.name, creator.name ?? 'Creator', campaign.id, image[0]);

            const socketId = clients.get(creator.id);
            if (socketId) {
              io.to(socketId).emit('notification', notification);
              // Emit shortlisted event with campaign data for popup
              io.to(socketId).emit('shortlisted', {
                message: 'shortlisted',
                campaignId: campaign.id,
                campaignName: campaign.name,
              });
            }

            if (!campaign.thread) throw new Error('Campaign thread not found');

            const isThreadExist = await tx.userThread.findFirst({
              where: {
                threadId: campaign.thread.id,
                userId: creator.id as string,
              },
            });

            if (!isThreadExist) {
              await tx.userThread.create({
                data: {
                  threadId: campaign.thread.id,
                  userId: creator.id as string,
                },
              });
            }
          }
        } catch (error) {
          console.error('Transaction error:', error);
          throw error;
        }
      },
      { timeout: 10000 },
    );

    const adminLogMessage = `Creator Shortlisted for Campaign - ${campaignId.name} `;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({ message: 'Successfully shortlisted' });
  } catch (error) {
    console.log('SHORTLIST ERROR', error);
    return res.status(400).json(error);
  }
};

export const shortlistCreatorV2 = async (req: Request, res: Response) => {
  const { creators, campaignId } = req.body;

  console.log('shortlistCreatorV2 called with:', { creators, campaignId });

  try {
    await prisma.$transaction(async (tx) => {
      try {
        const campaign = await tx.campaign.findUnique({
          where: {
            id: campaignId,
          },
          include: {
            shortlisted: true,
            thread: true,
            campaignBrief: true,
          },
        });

        if (!campaign) throw new Error('Campaign not found');

        // Check if this is an admin-created campaign
        if (campaign.origin === 'CLIENT') {
          throw new Error(
            'This endpoint is for admin-created campaigns only. Use shortlistCreatorV2ForClient for client-created campaigns.',
          );
        }

        if (!campaign?.campaignCredits) throw new Error('Campaign is not assigned to any credits');

        const existingCreators = campaign.shortlisted.reduce((acc, creator) => acc + (creator.ugcVideos ?? 0), 0);

        const totalCreditsAssigned = creators.reduce(
          (acc: number, creator: { credits: number }) => acc + creator.credits,
          0,
        );

        if (totalCreditsAssigned > campaign.campaignCredits - existingCreators) throw new Error('Credits exceeded');

        const creatorIds = creators.map((c: any) => c.id);

        const creatorData = await tx.user.findMany({
          where: { id: { in: creatorIds } },
          include: { creator: true, paymentForm: true },
        });

        // await tx.campaign.update({
        //   where: {
        //     id: campaign.id,
        //   },
        //   data: {
        //     creditsUtilized: {
        //       increment: totalCreditsAssigned,
        //     },
        //     creditsPending: {
        //       decrement: totalCreditsAssigned,
        //     },
        //   },
        // });

        await Promise.all(
          creatorData.map((creator) =>
            tx.creatorAgreement.upsert({
              where: {
                userId_campaignId: {
                  userId: creator.id,
                  campaignId: campaign.id,
                },
              },
              update: {},
              create: {
                userId: creator.id,
                campaignId: campaign.id,
                agreementUrl: '',
              },
            }),
          ),
        );

        await Promise.all(
          creators.map((creator: any) =>
            tx.shortListedCreator.upsert({
              where: {
                userId_campaignId: {
                  userId: creator.id,
                  campaignId,
                },
              },
              update: {
                ugcVideos: creator.credits,
              },
              create: {
                userId: creator.id,
                campaignId,
                ugcVideos: creator.credits,
              },
            }),
          ),
        );

        const boards = await tx.board.findMany({
          where: { userId: { in: creatorIds } },
          include: { columns: true },
        });

        const timelines = await tx.campaignTimeline.findMany({
          where: {
            campaignId: campaign.id,
            for: 'creator',
            name: { not: 'Open For Pitch' },
          },
          include: { submissionType: true },
          orderBy: { order: 'asc' },
        });

        for (const creator of creatorData) {
          const board = boards.find((b) => b.userId === creator.id);
          if (!board) throw new Error(`Board not found for user ${creator.id}`);

          const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
          const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));
          if (!columnToDo || !columnInProgress) throw new Error('Columns not found.');

          type SubmissionWithRelations = Submission & {
            submissionType: SubmissionType;
          };

          const submissions: any[] = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await tx.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: campaign.id,
                  userId: creator.id as string,
                  // status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );

          // Create dependencies
          const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
          const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
          const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
          const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

          const dependencies = [
            { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
            { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
            { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
          ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

          if (dependencies.length) await tx.submissionDependency.createMany({ data: dependencies });
        }

        // Notify admins & creators
        const admins = await tx.campaignAdmin.findMany({
          where: { campaignId },
          include: { admin: { include: { user: true } } },
        });

        for (const creator of creatorData) {
          const notification = await saveNotification({
            userId: creator.id,
            entityId: campaignId,
            message: `Congratulations! You've been shortlisted for the ${campaign.name} campaign.`,
            entity: 'Shortlist',
          });

          const image: any = campaign.campaignBrief?.images;
          shortlisted(creator.email, campaign.name, creator.name ?? 'Creator', campaign.id, image[0]);

          const socketId = clients.get(creator.id);
          if (socketId) {
            io.to(socketId).emit('notification', notification);
            // Emit shortlisted event with campaign data for popup
            io.to(socketId).emit('shortlisted', {
              message: 'shortlisted',
              campaignId: campaign.id,
              campaignName: campaign.name,
            });
          }

          if (!campaign.thread) throw new Error('Campaign thread not found');

          const isThreadExist = await tx.userThread.findFirst({
            where: {
              threadId: campaign.thread.id,
              userId: creator.id as string,
            },
          });

          if (!isThreadExist) {
            await tx.userThread.create({
              data: {
                threadId: campaign.thread.id,
                userId: creator.id as string,
              },
            });
          }
        }
      } catch (error) {
        throw new Error(error);
      }
    });

    // After successful shortlist, sync creators-campaign sheet (best-effort)
    try {
      await syncCreatorsCampaignSheetInternal();
    } catch (err) {
      console.log('Sheet sync failed (non-blocking):', err);
    }

    return res.status(200).json({ message: 'Successfully shortlisted creators' });
  } catch (error) {
    if (error?.message) {
      return res.status(400).json(error?.message);
    }
    return res.status(400).json(error);
  }
};

export const getClientCampaigns = async (req: Request, res: Response) => {
  const { userid } = req.session;

  console.log('getClientCampaigns called for user ID:', userid);

  // Check if user session exists
  if (!userid) {
    console.log('No user session found');
    return res.status(401).json({ message: 'Unauthorized. No user session found.' });
  }

  try {
    // Get the user first
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    console.log('User found:', {
      id: user?.id,
      role: user?.role,
      clientId: user?.client?.id,
      companyId: user?.client?.companyId,
    });

    // Make sure user exists
    if (!user) {
      console.log('User not found');
      return res.status(401).json({ message: 'Unauthorized. User not found.' });
    }

    // Check if the user has any campaign admin entries (backwards compatibility)
    const campaignAdminEntries = await prisma.campaignAdmin.findMany({
      where: {
        adminId: userid,
      },
    });

    console.log(`Found ${campaignAdminEntries.length} campaignAdmin entries for user ${userid}`);

    // Also check CampaignClient entries if user is a client
    let campaignClientEntries: { campaignId: string }[] = [];
    if (user.client?.id) {
      campaignClientEntries = await prisma.campaignClient.findMany({
        where: {
          clientId: user.client.id,
        },
        select: {
          campaignId: true,
        },
      });
      console.log(`Found ${campaignClientEntries.length} campaignClient entries for client ${user.client.id}`);
    }

    // Combine campaign IDs from both CampaignAdmin and CampaignClient
    const campaignIdsFromAdmin = campaignAdminEntries.map((entry) => entry.campaignId);
    const campaignIdsFromClient = campaignClientEntries.map((entry) => entry.campaignId);
    const allCampaignIds = [...new Set([...campaignIdsFromAdmin, ...campaignIdsFromClient])];

    console.log(`Total unique campaign IDs: ${allCampaignIds.length}`);

    // Find campaigns where user is either in CampaignAdmin OR CampaignClient
    const campaigns = await prisma.campaign.findMany({
      where: {
        OR: [
          {
            campaignAdmin: {
              some: {
                adminId: userid,
              },
            },
          },
          ...(user.client?.id
            ? [
                {
                  campaignClients: {
                    some: {
                      clientId: user.client.id,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      include: {
        brand: { include: { company: true } },
        company: true,
        campaignBrief: true,
        campaignTimeline: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`Found ${campaigns.length} campaigns for user ${userid}`);
    if (campaigns.length > 0) {
      console.log(
        'Campaign IDs:',
        campaigns.map((c) => c.id),
      );
      console.log(
        'Campaign statuses:',
        campaigns.map((c) => c.status),
      );
    }

    return res.status(200).json(campaigns);
  } catch (error) {
    console.error('Error fetching client campaigns:', error);
    return res.status(400).json({ message: 'Error fetching campaigns', error });
  }
};

export const activateClientCampaign = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;
    const { campaignId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if user is an admin/superadmin
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: { include: { role: true } },
      },
    });

    if (!user) {
      return res.status(403).json({ message: 'User not found' });
    }

    // Allow both admin and superadmin roles
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only admin or superadmin users can activate client campaigns' });
    }

    console.log('User found:', {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
    });

    // Parse request data
    let data;
    try {
      data = JSON.parse(req.body.data);
    } catch (error) {
      return res.status(400).json({ message: 'Invalid data format' });
    }

    const {
      campaignType,
      deliverables,
      campaignManager,
      agreementTemplateId,
      status,
      postingStartDate,
      postingEndDate,
    } = data;

    console.log('Received data:', {
      campaignType,
      deliverables,
      campaignManager,
      agreementTemplateId,
      status,
      postingStartDate,
      postingEndDate,
    });

    // Validate required fields
    if (!campaignType) {
      return res.status(400).json({ message: 'Campaign type is required' });
    }

    if (!campaignManager || (Array.isArray(campaignManager) && campaignManager.length === 0)) {
      return res.status(400).json({ message: 'At least one admin manager is required' });
    }

    // Ensure campaignManager is always an array
    const campaignManagerArray = Array.isArray(campaignManager) ? campaignManager : [campaignManager];

    if (!agreementTemplateId) {
      return res.status(400).json({ message: 'Agreement template is required' });
    }

    // Check if campaign exists and is in PENDING_ADMIN_ACTIVATION or SCHEDULED status
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        status: {
          in: ['PENDING_ADMIN_ACTIVATION', 'SCHEDULED'],
        },
      },
      include: {
        company: true,
      },
    });

    if (!campaign) {
      return res
        .status(404)
        .json({ message: 'Campaign has already been activated or is not in pending admin activation/scheduled status' });
    }

    // Log user info for debugging
    console.log('User activating campaign:', {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      adminMode: user.admin?.mode,
      adminRoleId: user.admin?.roleId,
    });

    // Process deliverables
    const rawFootage = deliverables?.includes('RAW_FOOTAGES') || false;
    const photos = deliverables?.includes('PHOTOS') || false;
    const ads = deliverables?.includes('ADS') || false;
    const crossPosting = deliverables?.includes('CROSS_POSTING') || false;

    // Update campaign with CSM-provided information
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: campaignId,
      },
      data: {
        status: 'ACTIVE',
        campaignType,
        rawFootage,
        photos,
        ads,
        crossPosting,
        agreementTemplate: {
          connect: {
            id: agreementTemplateId,
          },
        },
      },
    });

    // Create campaign timelines for creators
    // This is necessary for creators to see the campaign in their discovery feed
    console.log('Creating campaign timelines for creators');

    try {
      // Create default timeline types if they don't exist
      const submissionTypes = await prisma.submissionType.findMany();
      if (!submissionTypes.length) {
        console.log('No submission types found, creating default ones');
        await prisma.submissionType.createMany({
          data: [
            { type: 'AGREEMENT_FORM', description: 'Agreement Form' },
            { type: 'FIRST_DRAFT', description: 'First Draft' },
            { type: 'FINAL_DRAFT', description: 'Final Draft' },
            { type: 'POSTING', description: 'Posting' },
            { type: 'OTHER', description: 'Other' },
          ],
          skipDuplicates: true,
        });
      }

      // Get campaign brief for dates
      const campaignBrief = await prisma.campaignBrief.findUnique({
        where: { campaignId },
      });

      if (!campaignBrief) {
        console.error('Campaign brief not found for campaign', campaignId);
        throw new Error('Campaign brief not found');
      }

      // Update CampaignBrief with posting dates if provided
      if (postingStartDate || postingEndDate) {
        await prisma.campaignBrief.update({
          where: { campaignId },
          data: {
            ...(postingStartDate && { postingStartDate: new Date(postingStartDate) }),
            ...(postingEndDate && { postingEndDate: new Date(postingEndDate) }),
          },
        });
        console.log('Updated CampaignBrief with posting dates:', { postingStartDate, postingEndDate });
      }

      // Calculate timeline dates based on campaign start and end dates
      const startDate = new Date(campaignBrief.startDate);
      const endDate = new Date(campaignBrief.endDate);
      const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

      // Get submission types
      const agreementFormType = await prisma.submissionType.findFirst({ where: { type: 'AGREEMENT_FORM' } });
      const firstDraftType = await prisma.submissionType.findFirst({ where: { type: 'FIRST_DRAFT' } });
      const finalDraftType = await prisma.submissionType.findFirst({ where: { type: 'FINAL_DRAFT' } });
      const postingType = await prisma.submissionType.findFirst({ where: { type: 'POSTING' } });

      if (!agreementFormType || !firstDraftType || !finalDraftType || !postingType) {
        console.error('Required submission types not found');
        throw new Error('Required submission types not found');
      }

      // Create timelines
      const timelinesToCreate = [
        {
          name: 'Open For Pitch', // This name must exactly match what the frontend is looking for
          for: 'creator',
          duration: Math.max(3, Math.floor(totalDays * 0.2)),
          startDate: startDate,
          endDate: new Date(startDate.getTime() + Math.max(3, Math.floor(totalDays * 0.2)) * 24 * 60 * 60 * 1000),
          order: 1,
          status: 'OPEN' as TimelineStatus,
          campaignId,
        },
        {
          name: 'Agreement',
          for: 'creator',
          duration: Math.max(2, Math.floor(totalDays * 0.1)),
          startDate: startDate,
          endDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
          order: 2,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: agreementFormType.id,
        },
        {
          name: 'First Draft',
          for: 'creator',
          duration: Math.max(3, Math.floor(totalDays * 0.2)),
          startDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
          endDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          order: 3,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: firstDraftType.id,
        },
        {
          name: 'Final Draft',
          for: 'creator',
          duration: Math.max(3, Math.floor(totalDays * 0.2)),
          startDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          endDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) +
                Math.max(3, Math.floor(totalDays * 0.2)) +
                Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          order: 4,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: finalDraftType.id,
        },
        {
          name: 'Posting',
          for: 'creator',
          duration:
            postingStartDate && postingEndDate
              ? Math.max(
                  1,
                  Math.floor(
                    (new Date(postingEndDate).getTime() - new Date(postingStartDate).getTime()) / (1000 * 60 * 60 * 24),
                  ),
                )
              : Math.max(2, Math.floor(totalDays * 0.1)),
          startDate: postingStartDate
            ? new Date(postingStartDate)
            : new Date(
                startDate.getTime() +
                  (Math.max(2, Math.floor(totalDays * 0.1)) +
                    Math.max(3, Math.floor(totalDays * 0.2)) +
                    Math.max(3, Math.floor(totalDays * 0.2))) *
                    24 *
                    60 *
                    60 *
                    1000,
              ),
          endDate: postingEndDate ? new Date(postingEndDate) : endDate,
          order: 5,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: postingType.id,
        },
      ];

      // Create all timelines one by one to ensure they are created correctly
      console.log('Creating timelines one by one for better error handling...');

      const createdTimelines = [];
      for (const timeline of timelinesToCreate) {
        try {
          const createdTimeline = await prisma.campaignTimeline.create({
            data: timeline,
          });
          createdTimelines.push(createdTimeline);
          console.log(`Successfully created timeline: ${createdTimeline.name}`);
        } catch (error) {
          console.error(`Error creating timeline ${timeline.name}:`, error);
        }
      }

      // Verify the Open For Pitch timeline was created correctly
      const openForPitchTimeline = await prisma.campaignTimeline.findFirst({
        where: {
          campaignId,
          name: 'Open For Pitch',
          status: 'OPEN',
        },
      });

      console.log('Open For Pitch timeline found?', openForPitchTimeline ? 'YES' : 'NO');
      if (openForPitchTimeline) {
        console.log('Open For Pitch timeline details:', {
          id: openForPitchTimeline.id,
          name: openForPitchTimeline.name,
          status: openForPitchTimeline.status,
          for: openForPitchTimeline.for,
          campaignId: openForPitchTimeline.campaignId,
        });
      } else {
        console.error(
          'Failed to create Open For Pitch timeline! This will prevent the campaign from appearing in creator discovery.',
        );
      }

      console.log('Successfully created campaign timelines for creators');
    } catch (error) {
      console.error('Error creating campaign timelines for creators:', error);
      // Don't throw the error, as we still want to complete the activation process
    }

    // Add admin managers to the campaign
    console.log('Adding admin managers:', campaignManagerArray);

    for (const adminId of campaignManagerArray) {
      try {
        console.log(`Adding admin ${adminId} to campaign ${campaignId}`);

        // Check if the admin exists
        const admin = await prisma.admin.findFirst({
          where: {
            id: adminId,
          },
        });

        if (!admin) {
          console.log(`Admin with ID ${adminId} not found, trying as userId instead`);

          // Try to find admin by userId
          const adminByUserId = await prisma.admin.findFirst({
            where: {
              userId: adminId,
            },
          });

          if (adminByUserId) {
            await prisma.campaignAdmin.create({
              data: {
                adminId: adminByUserId.userId,
                campaignId,
              },
            });
            console.log(`Successfully added admin with userId ${adminId} to campaign`);
          } else {
            console.error(`No admin found with ID or userId ${adminId}`);
          }
        } else {
          await prisma.campaignAdmin.create({
            data: {
              adminId: adminId,
              campaignId,
            },
          });
          console.log(`Successfully added admin ${adminId} to campaign`);
        }
      } catch (error) {
        console.error(`Error adding admin ${adminId} to campaign:`, error);
        // Continue with other admins even if one fails
      }
    }

    // Create campaign log for activation
    const campaignActivityMessage = `Campaign Activated`;
    await prisma.campaignLog.create({
      data: {
        message: campaignActivityMessage,
        adminId: user.id,
        campaignId,
      },
    });

    // Check if campaign would appear in creator discovery feed
    try {
      console.log('Checking if campaign would appear in creator discovery feed...');

      // Query the campaign with the same conditions used in matchCampaignWithCreator
      const activatedCampaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          status: 'ACTIVE',
        },
        include: {
          campaignTimeline: true,
        },
      });

      // Check if the campaign has an "Open For Pitch" timeline with status "OPEN"
      const hasOpenForPitchTimeline = activatedCampaign?.campaignTimeline?.some(
        (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
      );

      console.log('Campaign status:', activatedCampaign?.status);
      console.log('Has Open For Pitch timeline with OPEN status:', hasOpenForPitchTimeline);
      console.log(
        'Campaign should appear in creator discovery feed:',
        activatedCampaign?.status === 'ACTIVE' && hasOpenForPitchTimeline,
      );
    } catch (error) {
      console.error('Error checking creator discovery eligibility:', error);
    }

    // Create notification for client and add clients to CampaignClient + CampaignAdmin for v4 campaigns only
    // For non-v4 campaigns, we still create notifications but don't add to CampaignClient/CampaignAdmin
    const isV4Campaign = campaign.submissionVersion === 'v4';

    if (campaign.companyId) {
      const clientUsers = await prisma.user.findMany({
        where: {
          client: {
            companyId: campaign.companyId,
          },
        },
        include: {
          client: true,
        },
      });

      console.log(`Found ${clientUsers.length} clients for company ${campaign.companyId}`);

      for (const clientUser of clientUsers) {
        // Only add clients to CampaignClient and CampaignAdmin for v4 campaigns
        if (isV4Campaign && clientUser.client) {
          // Add to CampaignClient
          try {
            const existingCampaignClient = await prisma.campaignClient.findUnique({
              where: {
                clientId_campaignId: {
                  clientId: clientUser.client.id,
                  campaignId,
                },
              },
            });

            if (!existingCampaignClient) {
              await prisma.campaignClient.create({
                data: {
                  clientId: clientUser.client.id,
                  campaignId,
                  role: 'owner',
                },
              });
              console.log(`Added client ${clientUser.client.id} to CampaignClient for v4 campaign ${campaignId}`);
            }
          } catch (error) {
            console.error(`Error adding client ${clientUser.id} to CampaignClient:`, error);
          }

          // Also add to CampaignAdmin for backwards compatibility
          try {
            const existingCampaignAdmin = await prisma.campaignAdmin.findUnique({
              where: {
                adminId_campaignId: {
                  adminId: clientUser.id,
                  campaignId,
                },
              },
            });

            if (!existingCampaignAdmin) {
              await prisma.campaignAdmin.create({
                data: {
                  adminId: clientUser.id,
                  campaignId,
                },
              });
              console.log(`Added client user ${clientUser.id} to CampaignAdmin for v4 campaign ${campaignId}`);
            }
          } catch (error) {
            console.error(`Error adding client ${clientUser.id} to CampaignAdmin:`, error);
          }
        }

        // Create notification for all clients regardless of v4 status
        await prisma.notification.create({
          data: {
            title: 'Campaign Activated',
            message: `Your campaign "${campaign.name}" has been activated by CSM`,
            entity: 'Campaign',
            campaignId,
            userId: clientUser.id,
          },
        });
      }
    }

    // Log the campaign admin entries for this campaign
    const campaignAdminEntries = await prisma.campaignAdmin.findMany({
      where: {
        campaignId,
      },
      include: {
        admin: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    console.log(`Campaign ${campaignId} now has ${campaignAdminEntries.length} admin entries`);
    console.log(
      'Admin IDs:',
      campaignAdminEntries.map((entry) => entry.adminId),
    );

    // Create a thread for the campaign if it doesn't exist
    try {
      const existingThread = await prisma.thread.findFirst({
        where: {
          campaignId: campaignId,
        },
        include: {
          UserThread: true,
        },
      });

      // Collect all user IDs that should be in the thread (clients + admins from campaignAdmin)
      const userIdsForThread = campaignAdminEntries.map((entry) => entry.adminId);

      if (!existingThread) {
        console.log('Creating thread for client campaign with users:', userIdsForThread);
        await prisma.thread.create({
          data: {
            campaignId: campaignId,
            title: `Campaign Thread - ${campaign.name}`,
            description: `Thread for campaign ${campaign.name}`,
            isGroup: userIdsForThread.length > 2,
            UserThread: {
              create: userIdsForThread.map((userId) => ({
                userId,
              })),
            },
          },
        });
        console.log('Thread created successfully for client campaign with users added to UserThread');
      } else {
        console.log('Thread already exists for this campaign, checking if users need to be added');
        // Add any missing users to the existing thread
        const existingUserIds = existingThread.UserThread.map((ut) => ut.userId);
        const missingUserIds = userIdsForThread.filter((id) => !existingUserIds.includes(id));

        if (missingUserIds.length > 0) {
          console.log('Adding missing users to thread:', missingUserIds);
          await prisma.userThread.createMany({
            data: missingUserIds.map((userId) => ({
              userId,
              threadId: existingThread.id,
            })),
            skipDuplicates: true,
          });
          console.log('Missing users added to thread successfully');
        }
      }
    } catch (error) {
      console.error('Error creating thread for client campaign:', error);
      // Don't fail the activation if thread creation fails
    }

    // Notify Client, CSL and Superadmin when campaign is activated by CSM
    const usersToNotify = await prisma.user.findMany({
      where: {
        OR: [
          {
            role: {
              in: ['client', 'admin'],
            },
          },
          {
            admin: {
              role: {
                name: 'CSL',
              },
            },
          },
        ],
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (usersToNotify.length > 0) {
      for (const adminUser of usersToNotify) {
        let title = '';
        let message = '';

        if (adminUser.role === 'client') {
          title = `🚀 ${campaign.name} is now live!`;
          message = `Your campaign "${campaign.name}" has been activated by CSM`;
        } else {
          title = `🚀 Campaign Activated: ${campaign.name} `;
          message = `The campaign "${campaign.name}" has been activated and the client has been notified`;
        }

        const notification = await saveNotification({
          userId: adminUser.id,
          title: title,
          message: message,
          entity: 'Campaign',
          entityId: campaign.id,
          campaignId: campaign.id,
        });
        const socketId = clients.get(adminUser.id);

        if (socketId) {
          io.to(socketId).emit('notification', notification);
          console.log(`Sent real-time notification to user ${adminUser.id} on socket ${socketId}`);
        }
      }
    }

    return res.status(200).json({
      message: 'Client campaign activated successfully',
      campaign: updatedCampaign,
    });
  } catch (error: any) {
    console.error('Error activating client campaign:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while activating client campaign',
    });
  }
};

// Debug endpoint to update campaign origin for testing
export const updateCampaignOrigin = async (req: Request, res: Response) => {
  const { campaignId, origin } = req.body;

  try {
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: { origin: origin as 'ADMIN' | 'CLIENT' },
    });

    console.log(`Updated campaign ${campaignId} origin to ${origin}`);
    return res.status(200).json({
      message: 'Campaign origin updated successfully',
      campaign: updatedCampaign,
    });
  } catch (error) {
    console.error('Error updating campaign origin:', error);
    return res.status(500).json({ message: 'Failed to update campaign origin' });
  }
};

// Check campaign admin entries for the current user
export const checkCampaignAdmin = async (req: Request, res: Response) => {
  const { userid } = req.session;

  console.log('checkCampaignAdmin called for user ID:', userid);

  // Check if user session exists
  if (!userid) {
    console.log('No user session found');
    return res.status(401).json({ message: 'Unauthorized. No user session found.' });
  }

  try {
    // Get all campaign admin entries for this user
    const campaignAdminEntries = await prisma.campaignAdmin.findMany({
      where: {
        adminId: userid,
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    console.log(`Found ${campaignAdminEntries.length} campaignAdmin entries for user ${userid}`);

    // For debugging, let's also check if there are any campaigns for the user's company
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    if (user?.client?.companyId) {
      const companyCampaigns = await prisma.campaign.findMany({
        where: {
          companyId: user.client.companyId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
        },
      });

      console.log(`Found ${companyCampaigns.length} campaigns for company ${user.client.companyId}`);
      if (companyCampaigns.length > 0) {
        console.log(
          'Company campaign IDs:',
          companyCampaigns.map((c) => c.id),
        );
        console.log(
          'Company campaign statuses:',
          companyCampaigns.map((c) => c.status),
        );
      }
    }

    return res.status(200).json(campaignAdminEntries);
  } catch (error) {
    console.error('Error checking campaign admin entries:', error);
    return res.status(400).json({ message: 'Error checking campaign admin entries', error });
  }
};

// Add client to campaign admin for all company campaigns
export const addClientToCampaignAdmin = async (req: Request, res: Response) => {
  const { userid } = req.session;

  console.log('addClientToCampaignAdmin called for user ID:', userid);

  // Check if user session exists
  if (!userid) {
    console.log('No user session found');
    return res.status(401).json({ message: 'Unauthorized. No user session found.' });
  }

  try {
    // Get the user first
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    // Make sure user exists and is a client
    if (!user || user.role !== 'client' || !user.client) {
      console.log('User not found or not a client');
      return res.status(403).json({ message: 'Only client users can use this endpoint' });
    }

    // Check if the user has a company
    if (!user.client.companyId) {
      console.log('Client has no company');
      return res.status(400).json({ message: 'Client must be associated with a company' });
    }

    // Find all campaigns for this company
    const companyCampaigns = await prisma.campaign.findMany({
      where: {
        companyId: user.client.companyId,
      },
      select: {
        id: true,
        name: true,
        status: true,
        submissionVersion: true, // Need this to check if v4
      },
    });

    console.log(`Found ${companyCampaigns.length} campaigns for company ${user.client.companyId}`);

    // Get the client ID from the user's client record
    const clientId = user.client.id;

    // Add the client to the CampaignAdmin and CampaignClient tables for each campaign
    const results = [];
    for (const campaign of companyCampaigns) {
      try {
        // Check if the client is already in the campaignAdmin table
        const existingCampaignAdmin = await prisma.campaignAdmin.findUnique({
          where: {
            adminId_campaignId: {
              adminId: userid,
              campaignId: campaign.id,
            },
          },
        });

        if (existingCampaignAdmin) {
          console.log(`Client ${userid} already in campaignAdmin for campaign ${campaign.id}`);
          results.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: 'already_exists',
          });
          continue;
        }

        // Add the client to the campaignAdmin table
        await prisma.campaignAdmin.create({
          data: {
            adminId: userid,
            campaignId: campaign.id,
          },
        });
        console.log(`Added client ${userid} to campaignAdmin for campaign ${campaign.id}`);

        // Also add to CampaignClient
        const existingCampaignClient = await prisma.campaignClient.findUnique({
          where: {
            clientId_campaignId: {
              clientId: clientId,
              campaignId: campaign.id,
            },
          },
        });

        if (!existingCampaignClient) {
          await prisma.campaignClient.create({
            data: {
              clientId: clientId,
              campaignId: campaign.id,
              role: 'owner',
            },
          });
          console.log(`Added client ${clientId} to CampaignClient for campaign ${campaign.id}`);
        }

        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          status: 'added',
        });
      } catch (error) {
        console.error(`Error adding client ${userid} to campaign ${campaign.id}:`, error);
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          status: 'error',
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      message: `Processed ${companyCampaigns.length} campaigns`,
      results,
    });
  } catch (error) {
    console.error('Error adding client to campaign admin:', error);
    return res.status(500).json({ message: 'Error adding client to campaign admin', error });
  }
};

// Add this function after the addClientToCampaignAdmin function
export const fixCampaignTimelines = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Find the campaign
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
        campaignTimeline: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    console.log(`Fixing timelines for campaign ${campaignId} (${campaign.name})`);

    // Check if Open For Pitch timeline exists
    const openForPitchExists = campaign.campaignTimeline.some(
      (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
    );

    if (openForPitchExists) {
      console.log('Campaign already has Open For Pitch timeline');
      return res.status(200).json({
        message: 'Campaign already has required timelines',
        campaign,
      });
    }

    // Get submission types
    const submissionTypes = await prisma.submissionType.findMany();
    if (submissionTypes.length === 0) {
      // Create default submission types if they don't exist
      await prisma.submissionType.createMany({
        data: [
          { type: 'AGREEMENT_FORM', description: 'Agreement Form' },
          { type: 'FIRST_DRAFT', description: 'First Draft' },
          { type: 'FINAL_DRAFT', description: 'Final Draft' },
          { type: 'POSTING', description: 'Posting' },
          { type: 'OTHER', description: 'Other' },
        ],
        skipDuplicates: true,
      });
    }

    const agreementFormType = await prisma.submissionType.findFirst({ where: { type: 'AGREEMENT_FORM' } });
    const firstDraftType = await prisma.submissionType.findFirst({ where: { type: 'FIRST_DRAFT' } });
    const finalDraftType = await prisma.submissionType.findFirst({ where: { type: 'FINAL_DRAFT' } });
    const postingType = await prisma.submissionType.findFirst({ where: { type: 'POSTING' } });

    if (!agreementFormType || !firstDraftType || !finalDraftType || !postingType) {
      return res.status(500).json({ message: 'Required submission types not found' });
    }

    // Calculate timeline dates based on campaign start and end dates
    const startDate = new Date(campaign.campaignBrief?.startDate || new Date());
    const endDate = new Date(campaign.campaignBrief?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Create timelines
    const timelinesToCreate = [
      {
        name: 'Open For Pitch', // This name must exactly match what the frontend is looking for
        for: 'creator',
        duration: Math.max(3, Math.floor(totalDays * 0.2)),
        startDate: startDate,
        endDate: new Date(startDate.getTime() + Math.max(3, Math.floor(totalDays * 0.2)) * 24 * 60 * 60 * 1000),
        order: 1,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
      },
      {
        name: 'Agreement',
        for: 'creator',
        duration: Math.max(2, Math.floor(totalDays * 0.1)),
        startDate: startDate,
        endDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
        order: 2,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: agreementFormType.id,
      },
      {
        name: 'First Draft',
        for: 'creator',
        duration: Math.max(3, Math.floor(totalDays * 0.2)),
        startDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
        endDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) * 24 * 60 * 60 * 1000,
        ),
        order: 3,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: firstDraftType.id,
      },
      {
        name: 'Final Draft',
        for: 'creator',
        duration: Math.max(3, Math.floor(totalDays * 0.2)),
        startDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) * 24 * 60 * 60 * 1000,
        ),
        endDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) +
              Math.max(3, Math.floor(totalDays * 0.2)) +
              Math.max(3, Math.floor(totalDays * 0.2))) *
              24 *
              60 *
              60 *
              1000,
        ),
        order: 4,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: finalDraftType.id,
      },
      {
        name: 'Posting',
        for: 'creator',
        duration: Math.max(2, Math.floor(totalDays * 0.1)),
        startDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) +
              Math.max(3, Math.floor(totalDays * 0.2)) +
              Math.max(3, Math.floor(totalDays * 0.2))) *
              24 *
              60 *
              60 *
              1000,
        ),
        endDate,
        order: 5,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: postingType.id,
      },
    ];

    // Create timelines one by one
    const createdTimelines = [];
    for (const timeline of timelinesToCreate) {
      try {
        const createdTimeline = await prisma.campaignTimeline.create({
          data: timeline,
        });
        createdTimelines.push(createdTimeline);
        console.log(`Created timeline: ${createdTimeline.name}`);
      } catch (error) {
        console.error(`Error creating timeline ${timeline.name}:`, error);
      }
    }

    // Verify the Open For Pitch timeline was created correctly
    const openForPitchTimeline = await prisma.campaignTimeline.findFirst({
      where: {
        campaignId: campaign.id,
        name: 'Open For Pitch',
        status: 'OPEN',
      },
    });

    if (!openForPitchTimeline) {
      return res.status(500).json({
        message: 'Failed to create Open For Pitch timeline',
        createdTimelines,
      });
    }

    // Update the campaign with the latest data
    const updatedCampaign = await prisma.campaign.findUnique({
      where: {
        id: campaign.id,
      },
      include: {
        campaignBrief: true,
        campaignTimeline: true,
      },
    });

    return res.status(200).json({
      message: 'Campaign timelines fixed successfully',
      campaign: updatedCampaign,
      createdTimelines,
    });
  } catch (error) {
    console.error('Error fixing campaign timelines:', error);
    return res.status(500).json({
      message: 'Error fixing campaign timelines',
      error,
    });
  }
};

// Add this function after the fixCampaignTimelines function
export const checkCampaignCreatorVisibility = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Find the campaign with all necessary relations
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
        campaignLogs: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Check campaign status
    const isActive = campaign.status === 'ACTIVE';

    // Check if campaign has Open For Pitch timeline with OPEN status
    const hasOpenForPitchTimeline = campaign.campaignTimeline.some(
      (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
    );

    // Check if campaign has required fields
    const hasBrief = !!campaign.campaignBrief;
    const hasRequirements = !!campaign.campaignRequirement;

    // Check campaign admins
    const admins = campaign.campaignAdmin.map((admin) => ({
      adminId: admin.adminId,
      role: admin.admin?.user?.role || 'unknown',
    }));

    // Check campaign creation logs
    const creationLogs = campaign.campaignLogs
      .filter((log: any) => log.action === 'CREATE_CAMPAIGN')
      .map((log: any) => ({
        userId: log.userId,
        role: log.userRole,
        timestamp: log.createdAt,
      }));

    // Determine if campaign should be visible to creators
    const shouldBeVisibleToCreators = isActive && hasOpenForPitchTimeline;

    // Prepare response with all checks
    const response = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      checks: {
        isActive,
        hasOpenForPitchTimeline,
        hasBrief,
        hasRequirements,
      },
      timelines: campaign.campaignTimeline.map((timeline) => ({
        name: timeline.name,
        status: timeline.status,
        for: timeline.for,
      })),
      admins,
      creationLogs,
      shouldBeVisibleToCreators,
      missingRequirements: [] as string[],
    };

    // Add missing requirements to the response
    if (!isActive) {
      response.missingRequirements.push('Campaign status must be ACTIVE');
    }
    if (!hasOpenForPitchTimeline) {
      response.missingRequirements.push('Campaign must have an "Open For Pitch" timeline with status "OPEN"');
    }
    if (!hasBrief) {
      response.missingRequirements.push('Campaign must have a brief');
    }
    if (!hasRequirements) {
      response.missingRequirements.push('Campaign must have requirements defined');
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error checking campaign visibility:', error);
    return res.status(500).json({
      message: 'Error checking campaign visibility',
      error,
    });
  }
};

// Add this function after the shortlistCreatorV2 function
export const shortlistCreatorV3 = async (req: Request, res: Response) => {
  // Support both per-creator adminComments (new) and legacy single adminComments (backward compat)
  const { creators, campaignId, adminComments: legacyAdminComments, ugcCredits } = req.body;
  const userId = req.session.userid;

  try {
    // Validate follower counts - max 10 billion (prevents 64-bit integer overflow)
    const MAX_FOLLOWER_COUNT = 10_000_000_000;
    for (const creator of creators) {
      if (creator.followerCount && creator.followerCount > MAX_FOLLOWER_COUNT) {
        return res.status(400).json({
          message: `Follower count for creator exceeds maximum allowed value (${MAX_FOLLOWER_COUNT.toLocaleString()}). Please enter a valid follower count.`,
        });
      }
    }

    // Allow superadmin to bypass campaign admin check
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isSuperadmin = currentUser?.role === 'superadmin';
    console.log(`shortlistCreatorV3: Shortlisting creators for campaign ${campaignId} by user ${userId}`);
    console.log(`Creators to shortlist:`, creators);

    // Check if the user has access to this campaign (is admin or client who created it)
    const campaignAccess = await prisma.campaignAdmin.findFirst({
      where: {
        campaignId,
        adminId: userId,
      },
      include: {
        admin: {
          include: {
            user: true,
          },
        },
        campaign: {
          include: {
            campaignLogs: true,
          },
        },
      },
    });

    // Check if user is client who created this campaign
    const isClientCreator = campaignAccess?.admin?.user?.role === 'client';
    // Note: campaignLogs might have different structure, we'll just check if user is a client
    const isClientCreatedCampaign = isClientCreator;

    console.log(`User role: ${campaignAccess?.admin?.user?.role}`);
    console.log(`Is client who created campaign: ${isClientCreator && isClientCreatedCampaign}`);

    // If not authorized, return error
    if (!campaignAccess && !isSuperadmin) {
      return res.status(403).json({ message: 'Not authorized to shortlist creators for this campaign' });
    }

    await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.findUnique({
        where: {
          id: campaignId,
        },
        include: {
          shortlisted: true,
          thread: true,
          campaignBrief: true,
        },
      });

      if (!campaign) throw new Error('Campaign not found');

      const isV4Campaign = campaign.submissionVersion === 'v4';
      const creatorIds = creators.map((c: any) => c.id);

      const creatorData = await tx.user.findMany({
        where: { id: { in: creatorIds } },
        include: { creator: true, paymentForm: true },
      });

      // Check if campaign has a thread
      const threadId = campaign.thread?.id;

      // For client-created campaigns, we'll continue even without a thread
      if (!threadId) {
        console.log('Client-created campaign without thread, continuing anyway');
      }

      // Process each creator
      for (const creator of creators) {
        const user = creatorData.find((u) => u.id === creator.id);
        if (!user) continue;

        console.log(`Processing creator: ${user.name} (${user.id})`);

        // If manual follower count provided, ALWAYS update the creator's manualFollowerCount and tier
        // This allows admins to correct follower count mistakes when re-adding creators
        if (creator.followerCount && creator.followerCount > 0) {
          const creatorRecord = await tx.creator.findUnique({
            where: { userId: user.id },
            include: { instagramUser: true, tiktokUser: true },
          });

          // Only update if no media kit connected (Instagram or TikTok)
          const hasMediaKit = creatorRecord?.instagramUser || creatorRecord?.tiktokUser;
          if (creatorRecord && !hasMediaKit) {
            console.log(`Updating manualFollowerCount for creator ${user.id} to ${creator.followerCount}`);

            // Find tier by follower count using transaction client to avoid timeout
            const tier = await tx.creditTier.findFirst({
              where: {
                isActive: true,
                minFollowers: { lte: creator.followerCount },
                OR: [
                  { maxFollowers: { gte: creator.followerCount } },
                  { maxFollowers: null },
                ],
              },
              orderBy: [{ minFollowers: 'desc' }],
            });

            await tx.creator.update({
              where: { userId: user.id },
              data: {
                manualFollowerCount: creator.followerCount,
                ...(tier && {
                  creditTierId: tier.id,
                  tierUpdatedAt: new Date(),
                }),
              },
            });

            if (tier) {
              console.log(`Updated credit tier for creator ${user.id}:`, tier.name);
            } else {
              console.log(`No matching tier found for creator ${user.id} with ${creator.followerCount} followers`);
            }
          }
        }

        // Check if already has a pitch for this campaign
        const existingPitch = await tx.pitch.findFirst({
          where: {
            userId: user.id,
            campaignId: campaign.id,
          },
        });

        if (existingPitch) {
          console.log(`Creator ${user.id} already has a pitch, skipping pitch creation`);
          continue;
        }

        // Determine status based on campaign type:
        // - v4 campaigns: SENT_TO_CLIENT (needs client approval)
        // - non-v4 campaigns: APPROVED directly
        const pitchStatus = isV4Campaign ? 'SENT_TO_CLIENT' : 'APPROVED';

        // Extract per-creator comments with fallback to legacy format
        const creatorAdminComments = creator.adminComments?.trim() || (typeof legacyAdminComments === 'string' ? legacyAdminComments.trim() : '');
        const hasComments = creatorAdminComments && creatorAdminComments.length > 0;

        // Create a pitch record for this creator
        console.log(`Creating pitch for creator ${user.id} with status ${pitchStatus}${hasComments ? ' and admin comments' : ''}`);
        await tx.pitch.create({
          data: {
            userId: user.id,
            campaignId: campaign.id,
            type: 'shortlisted',
            status: pitchStatus,
            content: `Creator ${user.name} has been shortlisted for campaign "${campaign.name}"`,
            amount: null,
            agreementTemplateId: null,
            approvedByAdminId: userId,
            ...(hasComments
              ? { adminComments: creatorAdminComments, adminCommentedBy: userId }
              : {}),
          },
        });

        // For non-v4 campaigns: Also create ShortListedCreator and submissions (direct approval)
        if (!isV4Campaign) {
          console.log(`Non-v4 campaign: Creating ShortListedCreator for ${user.id}`);

          // For credit tier campaigns, calculate creditPerVideo from creator's tier
          let creditPerVideo: number | null = null;
          let creditTierId: string | null = null;
          if (campaign.isCreditTier) {
            try {
              const { calculateCreatorTier } = require('@services/creditTierService');
              const { tier } = await calculateCreatorTier(user.id);
              if (tier) {
                creditPerVideo = tier.creditsPerVideo;
                creditTierId = tier.id;
              }
            } catch (error) {
              console.log(`Could not calculate tier for creator ${user.id}:`, error);
            }
          }

          // Create or update ShortListedCreator
          const existingShortlist = await tx.shortListedCreator.findUnique({
            where: {
              userId_campaignId: {
                userId: user.id,
                campaignId: campaign.id,
              },
            },
          });

          if (existingShortlist) {
            await tx.shortListedCreator.update({
              where: {
                userId_campaignId: {
                  userId: user.id,
                  campaignId: campaign.id,
                },
              },
              data: {
                isAgreementReady: false,
                ...(campaign.isCreditTier && creditPerVideo !== null && {
                  creditPerVideo,
                  creditTierId,
                }),
              },
            });
          } else {
            await tx.shortListedCreator.create({
              data: {
                userId: user.id,
                campaignId: campaign.id,
                isAgreementReady: false,
                currency: 'MYR',
                ...(campaign.isCreditTier && creditPerVideo !== null && {
                  creditPerVideo,
                  creditTierId,
                }),
              },
            });
          }

          // Create creatorAgreement for non-v4 campaigns
          const existingAgreement = await tx.creatorAgreement.findFirst({
            where: {
              userId: user.id,
              campaignId: campaign.id,
            },
          });

          if (!existingAgreement) {
            console.log(`Creating creatorAgreement for non-v4 shortlist - ${user.id}`);
            await tx.creatorAgreement.create({
              data: {
                userId: user.id,
                campaignId: campaign.id,
                agreementUrl: '',
              },
            });
          }

          // Create submission records for non-v4 campaigns
          const timelines = await tx.campaignTimeline.findMany({
            where: {
              campaignId: campaign.id,
              for: 'creator',
              name: { not: 'Open For Pitch' },
            },
            include: { submissionType: true },
            orderBy: { order: 'asc' },
          });

          // Get creator's board
          const board = await tx.board.findUnique({
            where: { userId: user.id },
            include: { columns: true },
          });

          if (board) {
            const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
            const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));

            if (columnToDo && columnInProgress) {
              console.log(`Creating submissions for non-v4 shortlist - ${timelines.length} timeline(s)`);

              // Create submissions for timeline items
              const submissions = await Promise.all(
                timelines.map(async (timeline, index) => {
                  return await tx.submission.create({
                    data: {
                      dueDate: timeline.endDate,
                      campaignId: timeline.campaignId,
                      userId: user.id,
                      status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                      submissionTypeId: timeline.submissionTypeId as string,
                      task: {
                        create: {
                          name: timeline.name,
                          position: index,
                          columnId: timeline.submissionType?.type ? columnInProgress.id : columnToDo.id,
                          priority: '',
                          status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                        },
                      },
                    },
                    include: {
                      submissionType: true,
                    },
                  });
                }),
              );

              // Create dependencies between submissions for non-v4 campaigns
              const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
              const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
              const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
              const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

              const dependencies = [
                { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
                { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
                { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
              ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

              if (dependencies.length > 0) {
                await tx.submissionDependency.createMany({ data: dependencies });
              }

              console.log(`Created ${submissions.length} submissions for non-v4 shortlist`);
            }
          }
        }

        // Add creator to thread if not already added and if thread exists
        if (threadId) {
          try {
            const existingUserThread = await tx.userThread.findUnique({
              where: {
                userId_threadId: {
                  userId: user.id,
                  threadId,
                },
              },
            });

            if (!existingUserThread) {
              await tx.userThread.create({
                data: {
                  userId: user.id,
                  threadId,
                },
              });
              console.log(`Added creator ${user.id} to thread ${threadId}`);
            }
          } catch (error) {
            console.error(`Error adding creator to thread:`, error);
          }
        }

        // Create appropriate notifications based on campaign type
        if (isV4Campaign) {
          // For v4: Notify client users for review
          const clientUsers = await tx.campaignAdmin.findMany({
            where: {
              campaignId: campaign.id,
              admin: {
                user: {
                  role: 'client',
                },
              },
            },
            include: {
              admin: {
                include: {
                  user: true,
                },
              },
            },
          });

          for (const clientUser of clientUsers) {
            await tx.notification.create({
              data: {
                title: 'New Creator Shortlisted',
                message: `Creator ${user.name} has been shortlisted for campaign "${campaign.name}". Please review and approve.`,
                entity: 'Pitch',
                campaignId: campaign.id,
                userId: clientUser.admin.userId,
              },
            });
          }
        } else {
          // For non-v4: Notify the creator they've been approved
          await tx.notification.create({
            data: {
              title: 'You have been selected! 🎉',
              message: `You have been approved for campaign "${campaign.name}". Check your agreements to get started.`,
              entity: 'Pitch',
              campaignId: campaign.id,
              userId: user.id,
            },
          });
        }
      }

      // Note: Credits are now only utilized when agreement is sent (in sendAgreement function)
      // ugcVideos is still assigned to shortlistedCreator for submission creation

      // Log campaign activity for each shortlisted creator
      for (const creator of creators) {
        const creatorUser = await tx.user.findUnique({
          where: { id: creator.id },
        });
        if (creatorUser) {
          await tx.campaignLog.create({
            data: {
              message: `${creatorUser.name || 'Creator'} has been shortlisted`,
              adminId: userId,
              campaignId: campaignId,
            },
          });
        }
      }
    });

    return res.status(200).json({ message: 'Successfully shortlisted creators for V3 flow' });
  } catch (error) {
    console.error('Error shortlisting creators for V3:', error);
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to shortlist creators',
      error,
    });
  }
};

// V2 Shortlist Creator for Client-Created Campaigns
export const shortlistCreatorV2ForClient = async (req: Request, res: Response) => {
  const { creators, campaignId } = req.body;

  console.log('shortlistCreatorV2ForClient called with:', { creators, campaignId });

  try {
    await prisma.$transaction(async (tx) => {
      try {
        const campaign = await tx.campaign.findUnique({
          where: {
            id: campaignId,
          },
          include: {
            shortlisted: true,
            thread: true,
            campaignBrief: true,
          },
        });

        if (!campaign) throw new Error('Campaign not found');

        // For client-created campaigns, we don't check campaignCredits as they're managed differently
        if (campaign.origin !== 'CLIENT') {
          throw new Error('This endpoint is only for client-created campaigns');
        }

        const existingCreators = campaign.shortlisted.reduce((acc, creator) => acc + (creator.ugcVideos ?? 0), 0);

        const totalCreditsAssigned = creators.reduce(
          (acc: number, creator: { credits: number }) => acc + creator.credits,
          0,
        );

        // For client campaigns, we can assign credits without strict limits
        // The client manages their own budget

        const creatorIds = creators.map((c: any) => c.id);

        const creatorData = await tx.user.findMany({
          where: { id: { in: creatorIds } },
          include: { creator: true, paymentForm: true },
        });

        // Check if campaign has a thread - for client-created campaigns, we'll continue even without a thread
        const threadId = campaign.thread?.id;

        if (!threadId) {
          console.log('Client-created campaign without thread, continuing anyway');
          // For client campaigns, we can proceed without a thread
        }

        await tx.shortListedCreator.createMany({
          data: creators.map((creator: any) => ({
            userId: creator.id,
            campaignId,
            ugcVideos: creator.credits,
          })),
        });

        const boards = await tx.board.findMany({
          where: { userId: { in: creatorIds } },
          include: { columns: true },
        });

        const timelines = await tx.campaignTimeline.findMany({
          where: {
            campaignId: campaign.id,
            for: 'creator',
            name: { not: 'Open For Pitch' },
          },
          include: { submissionType: true },
          orderBy: { order: 'asc' },
        });

        for (const creator of creatorData) {
          const board = boards.find((b) => b.userId === creator.id);
          if (!board) throw new Error(`Board not found for user ${creator.id}`);

          const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
          const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));
          if (!columnToDo || !columnInProgress) throw new Error('Columns not found.');

          type SubmissionWithRelations = Submission & {
            submissionType: SubmissionType;
          };

          const submissions: any[] = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await tx.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: campaign.id,
                  userId: creator.id as string,
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );
        }

        // Create notifications for shortlisted creators
        for (const creator of creatorData) {
          await tx.notification.create({
            data: {
              title: 'You have been shortlisted!',
              message: `Congratulations! You have been shortlisted for campaign "${campaign.name}".`,
              entity: 'Campaign',
              campaignId: campaign.id,
              userId: creator.id,
            },
          });

          // Handle thread creation for client campaigns if thread doesn't exist
          if (threadId) {
            const isThreadExist = await tx.userThread.findFirst({
              where: {
                threadId: threadId,
                userId: creator.id as string,
              },
            });

            if (!isThreadExist) {
              await tx.userThread.create({
                data: {
                  threadId: threadId,
                  userId: creator.id as string,
                },
              });
            }
          }
        }

        console.log(`Successfully shortlisted ${creatorData.length} creators for client campaign ${campaignId}`);
      } catch (error) {
        console.error('Error in shortlistCreatorV2ForClient transaction:', error);
        throw error;
      }
    });

    return res.status(200).json({ message: 'Creators shortlisted successfully' });
  } catch (error) {
    console.error('Error shortlisting creators for client campaign:', error);
    return res.status(400).json({ message: error.message || 'Failed to shortlist creators' });
  }
};

export const initialActivateCampaign = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;
    const { campaignId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if user is CSL or superadmin
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: { include: { role: true } },
      },
    });

    if (!user) {
      return res.status(403).json({ message: 'User not found' });
    }

    // Only allow CSL or superadmin (god mode) to do initial activation
    const isCSL = user.admin?.role?.name === 'CSL';
    const isSuperAdmin = user.admin?.mode === 'god';

    if (!isCSL && !isSuperAdmin) {
      return res.status(403).json({ message: 'Only CSL or Superadmin users can perform initial campaign activation' });
    }

    console.log('User performing initial activation:', {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      adminMode: user.admin?.mode,
      adminRoleName: user.admin?.role?.name,
    });

    // Parse request data
    let data;
    try {
      data = JSON.parse(req.body.data);
    } catch (error) {
      return res.status(400).json({ message: 'Invalid data format' });
    }

    const { campaignManager, creatorIds } = data;

    console.log('Received initial activation data:', { campaignManager });

    // Validate required fields
    if (!campaignManager || (Array.isArray(campaignManager) && campaignManager.length === 0)) {
      return res.status(400).json({ message: 'At least one admin manager is required' });
    }

    // Ensure campaignManager is always an array
    const campaignManagerArray = Array.isArray(campaignManager) ? campaignManager : [campaignManager];

    // Check if campaign exists and is in PENDING_CSM_REVIEW or SCHEDULED status
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        status: {
          in: ['PENDING_CSM_REVIEW', 'SCHEDULED'] as CampaignStatus[],
        },
      },
      include: {
        company: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found or not in pending/scheduled status' });
    }

    // Update campaign status to PENDING_ADMIN_ACTIVATION
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: campaignId,
      },
      data: {
        status: 'PENDING_ADMIN_ACTIVATION',
      },
    });

    // Add admin managers to the campaign
    for (const adminId of campaignManagerArray) {
      try {
        // Check if the admin exists
        const admin = await prisma.admin.findFirst({
          where: {
            id: adminId,
          },
        });

        if (!admin) {
          // Try to find admin by userId
          const adminByUserId = await prisma.admin.findFirst({
            where: {
              userId: adminId,
            },
          });

          if (adminByUserId) {
            await prisma.campaignAdmin.create({
              data: {
                adminId: adminByUserId.userId,
                campaignId,
              },
            });
          }
        } else {
          await prisma.campaignAdmin.create({
            data: {
              adminId: adminId,
              campaignId,
            },
          });
        }
      } catch (error) {
        console.error(`Error adding admin ${adminId} to campaign:`, error);
      }
    }

    // Handle creator notifications if creatorIds are provided
    if (creatorIds && Array.isArray(creatorIds) && creatorIds.length > 0) {
      const creatorData = await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        include: {
          creator: {
            include: {
              instagramUser: true,
              tiktokUser: true,
            },
          },
          paymentForm: true,
        },
      });

      if (creatorData.length > 0) {
        const creatorsForNotification: ShortlistedCreatorInput[] = creatorData.map((user) => {
          const instagramUser = user.creator?.instagramUser;
          const tiktokUser = user.creator?.tiktokUser;

          const metrics = calculateAverageMetrics(instagramUser ?? null, tiktokUser ?? null);
          const primaryUsername = instagramUser?.username || tiktokUser?.username;

          return {
            id: user.id,
            name: user.name,
            photoURL: user.photoURL,
            username: primaryUsername,
            followerCount: metrics.totalFollowerCount,
            engagementRate: metrics.averageEngagementRate,
          };
        });
        console.log('Handing off to notification service with combined data...');

        await prisma.$transaction(async (tx) => {
          await sendShortlistEmailToClients(campaignId, creatorsForNotification, tx);
        });
      }
    }

    // Only one notification for all creators
    const clientUsers = await prisma.campaignAdmin.findMany({
      where: {
        campaignId: campaign.id,
        admin: {
          user: {
            role: 'client',
          },
        },
      },
      include: {
        admin: {
          include: {
            user: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    for (const clientUser of clientUsers) {
      const { title, message } = notificationPitchForClientReview(campaign.name);

      await saveNotification({
        userId: clientUser.admin.userId,
        title: title,
        message: message,
        entity: 'Pitch',
        entityId: campaign.id,
      });
    }

    console.log('Campaign updated for initial activation:', {
      campaignId,
      newStatus: updatedCampaign.status,
      campaignManager: campaignManagerArray,
    });

    res.status(200).json({
      message: 'Campaign activated and assigned to admin. Waiting for admin to complete setup.',
      campaign: updatedCampaign,
    });
  } catch (error) {
    console.error('Error in initial campaign activation:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Add this function after the shortlistCreatorV3 function
export const assignUGCCreditsV3 = async (req: Request, res: Response) => {
  const { creators, campaignId } = req.body;
  const userId = req.session.userid;

  try {
    // Allow superadmin to bypass campaign admin check
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isSuperadmin = currentUser?.role === 'superadmin';
    console.log(`assignUGCCreditsV3: Assigning UGC credits for campaign ${campaignId} by user ${userId}`);
    console.log(`Creators with credits:`, creators);

    // Check if the user has access to this campaign (is admin or client who created it)
    const campaignAccess = await prisma.campaignAdmin.findFirst({
      where: {
        campaignId,
        adminId: userId,
      },
      include: {
        admin: {
          include: {
            user: true,
          },
        },
        campaign: {
          include: {
            shortlisted: true,
          },
        },
      },
    });

    // If not authorized, return error
    if (!campaignAccess && !isSuperadmin) {
      return res.status(403).json({ message: 'Not authorized to assign UGC credits for this campaign' });
    }

    // campaignAccess may be null for superadmin; fetch campaign directly in that case
    // Always fetch a fresh campaign instance to avoid mixed types from relations
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { shortlisted: true },
    });
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // For v4 campaigns, skip credit validation - credits are only validated when "Generate and Send" is clicked
    const isV4Campaign = campaign.submissionVersion === 'v4';

    // Calculate total credits being assigned (for logging purposes, even for v4 campaigns)
    const totalCreditsToAssign = creators.reduce((acc: number, creator: any) => acc + (creator.credits || 0), 0);

    if (!isV4Campaign) {
      // Compute already utilized credits from shortlisted creators
      const alreadyUtilized = (campaign.shortlisted || []).reduce((acc, item) => acc + (item.ugcVideos || 0), 0);

      // Enforce remaining credits check (campaignCredits - alreadyUtilized) - only for non-v4 campaigns
      if (campaign.campaignCredits && totalCreditsToAssign > campaign.campaignCredits - alreadyUtilized) {
        return res.status(400).json({
          message: `Not enough credits available. Remaining: ${
            campaign.campaignCredits - alreadyUtilized
          }, requested: ${totalCreditsToAssign}`,
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      // Process each creator
      for (const creator of creators) {
        if (!creator.credits || creator.credits <= 0) continue;

        console.log(`Assigning ${creator.credits} UGC credits to creator ${creator.id}`);

        // Check if creator is already shortlisted
        const existingShortlist = await tx.shortListedCreator.findUnique({
          where: {
            userId_campaignId: {
              userId: creator.id,
              campaignId: campaign.id,
            },
          },
        });

        if (existingShortlist) {
          // Update existing shortlist with UGC credits
          await tx.shortListedCreator.update({
            where: {
              userId_campaignId: {
                userId: creator.id,
                campaignId: campaign.id,
              },
            },
            data: {
              ugcVideos: creator.credits,
            },
          });
          console.log(`Updated UGC credits for existing shortlisted creator ${creator.id}`);
        } else {
          // Create new shortlist entry with UGC credits
          await tx.shortListedCreator.create({
            data: {
              userId: creator.id,
              campaignId: campaign.id,
              ugcVideos: creator.credits,
              currency: 'MYR', // Default currency for V3
            },
          });
          console.log(`Created new shortlist entry with UGC credits for creator ${creator.id}`);
        }
      }

      // Note: Credits are now only utilized when agreement is sent (in sendAgreement function)
      // ugcVideos is still assigned to shortlistedCreator for submission creation
      console.log(`UGC credits assigned to shortlisted creators - credits will be utilized when agreement is sent`);
    });

    return res.status(200).json({
      message: 'Successfully assigned UGC credits to creators',
      totalCreditsAssigned: totalCreditsToAssign,
    });
  } catch (error) {
    console.error('Error assigning UGC credits for V3:', error);
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to assign UGC credits',
      error,
    });
  }
};

// 3.1 Shortlisting Non-Platform (Guest) Creators
export const shortlistGuestCreators = async (req: Request, res: Response) => {
  const { campaignId, guestCreators } = req.body;
  const adminId = req.session.userid;

  if (!campaignId || !Array.isArray(guestCreators) || guestCreators.length === 0) {
    return res.status(400).json({ message: 'Campaign ID and a list of guest creators are required.' });
  }

  if (guestCreators.length > 3) {
    return res.status(400).json({ message: 'You can add a maximum of 3 guest creators at a time' });
  }

  // Validate follower counts - max 10 billion (prevents 64-bit integer overflow)
  const MAX_FOLLOWER_COUNT = 10_000_000_000;
  for (const guest of guestCreators) {
    if (guest.followerCount) {
      const parsedCount = parseInt(guest.followerCount, 10);
      if (!isNaN(parsedCount) && parsedCount > MAX_FOLLOWER_COUNT) {
        return res.status(400).json({
          message: `Follower count exceeds maximum allowed value (${MAX_FOLLOWER_COUNT.toLocaleString()}). Please enter a valid follower count.`,
        });
      }
    }
  }

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        campaignTimeline: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const isV4Campaign = campaign.submissionVersion === 'v4';

    const createdCreators: { id: string }[] = [];
    await prisma.$transaction(async (tx) => {
      for (const guest of guestCreators) {
        // give guest a userId
        const { userId } = await handleGuestForShortListing(guest, tx);

        // Update guest creator's manualFollowerCount and credit tier if followerCount provided
        if (guest.followerCount) {
          const parsedFollowerCount = parseInt(guest.followerCount, 10);
          if (!isNaN(parsedFollowerCount) && parsedFollowerCount > 0) {
            // Find tier by follower count using transaction client to avoid timeout
            const tier = await tx.creditTier.findFirst({
              where: {
                isActive: true,
                minFollowers: { lte: parsedFollowerCount },
                OR: [
                  { maxFollowers: { gte: parsedFollowerCount } },
                  { maxFollowers: null },
                ],
              },
              orderBy: [{ minFollowers: 'desc' }],
            });

            await tx.creator.update({
              where: { userId },
              data: {
                manualFollowerCount: parsedFollowerCount,
                ...(tier && {
                  creditTierId: tier.id,
                  tierUpdatedAt: new Date(),
                }),
              },
            });

            console.log(`Updated guest creator ${userId} manualFollowerCount to ${parsedFollowerCount}, tier: ${tier?.name || 'none'}`);
          }
        }

        // Check if guest has already been shortlisted
        const existingShortlist = await tx.shortListedCreator.findUnique({
          where: {
            userId_campaignId: {
              userId,
              campaignId,
            },
          },
        });

        if (existingShortlist) {
          console.log(`Guest creator ${guest.profileLink} is already shortlisted. Skipping.`);
          continue; // Skip and move to the next guest
        }

        // Also create a V3 pitch entry so it appears in the pitches list
        const existingPitch = await tx.pitch.findFirst({
          where: { userId, campaignId },
        });

        if (!existingPitch) {
          // For V4 campaigns: SENT_TO_CLIENT (awaiting client approval)
          // For non-v4 campaigns: APPROVED (admin approval is final)
          const pitchStatus = isV4Campaign ? 'SENT_TO_CLIENT' : 'APPROVED';

          await tx.pitch.create({
            data: {
              userId,
              campaignId,
              type: 'shortlisted',
              status: pitchStatus,
              content: `Non-platform creator has been shortlisted for campaign "${campaign.name}"`,
              amount: null,
              agreementTemplateId: null,
              approvedByAdminId: adminId,
              ...(guest.followerCount && { followerCount: guest.followerCount }),
              ...(guest.engagementRate && { engagementRate: guest.engagementRate }),
              ...(guest.adminComments && guest.adminComments.trim().length > 0
                ? { adminComments: guest.adminComments.trim(), adminCommentedBy: adminId }
                : {}),
            },
          });
        }

        // For non-v4 campaigns, create submissions and agreement immediately since admin approval is final
        if (!isV4Campaign) {
          // Create creatorAgreement for non-v4 campaigns
          const existingAgreement = await tx.creatorAgreement.findFirst({
            where: {
              userId,
              campaignId,
            },
          });

          if (!existingAgreement) {
            console.log(`Creating creatorAgreement for non-v4 guest shortlist - ${userId}`);
            await tx.creatorAgreement.create({
              data: {
                userId,
                campaignId,
                agreementUrl: '',
              },
            });
          }

          // Get timelines for creator submissions
          const timelines = await tx.campaignTimeline.findMany({
            where: {
              campaignId: campaign.id,
              for: 'creator',
              name: { not: 'Open For Pitch' },
            },
            include: { submissionType: true },
            orderBy: { order: 'asc' },
          });

          // Get guest user's board
          const guestUser = await tx.user.findUnique({
            where: { id: userId },
            include: {
              Board: {
                include: { columns: true },
              },
            },
          });

          const board = guestUser?.Board;

          if (board) {
            const columnToDo = board.columns.find((c: { name: string }) => c.name.includes('To Do'));
            const columnInProgress = board.columns.find((c: { name: string }) => c.name.includes('In Progress'));

            if (columnToDo && columnInProgress) {
              console.log(`Creating submissions for non-v4 guest shortlist - ${timelines.length} timeline(s)`);

              // Create submissions for timeline items
              const submissions = await Promise.all(
                timelines.map(async (timeline, index) => {
                  return await tx.submission.create({
                    data: {
                      dueDate: timeline.endDate,
                      campaignId: timeline.campaignId,
                      userId,
                      status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                      submissionTypeId: timeline.submissionTypeId as string,
                      task: {
                        create: {
                          name: timeline.name,
                          position: index,
                          columnId: timeline.submissionType?.type ? columnInProgress.id : columnToDo.id,
                          priority: '',
                          status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                        },
                      },
                    },
                    include: {
                      submissionType: true,
                    },
                  });
                }),
              );

              // Create dependencies between submissions for non-v4 campaigns
              const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
              const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
              const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
              const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

              const dependencies = [
                { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
                { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
                { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
              ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

              if (dependencies.length > 0) {
                await tx.submissionDependency.createMany({ data: dependencies });
              }

              console.log(`Created ${submissions.length} submissions for non-v4 guest shortlist`);
            }
          }
        }

        createdCreators.push({ id: userId });
      }

      // Log campaign activity for each guest creator shortlisted
      for (const creatorId of createdCreators) {
        const guestUser = await tx.user.findUnique({
          where: { id: creatorId.id },
        });
        if (guestUser) {
          await tx.campaignLog.create({
            data: {
              message: `${guestUser.name || 'Guest Creator'} has been shortlisted`,
              adminId: adminId,
              campaignId: campaignId,
            },
          });
        }
      }
    });

    const statusText = isV4Campaign ? 'sent to client for review' : 'approved and added';
    const adminLogMessage = `Shortlisted ${guestCreators.length} guest creator(s) for Campaign "${campaign.name}" - ${statusText}`;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({
      message: `Guest creators successfully ${isV4Campaign ? 'shortlisted' : 'approved'}.`,
      createdCreators,
      isV4Campaign,
    });
  } catch (error) {
    console.error('GUEST SHORTLIST ERROR:', error);
    return res.status(400).json({ message: error.message || 'Failed to shortlist guest creators.' });
  }
};

export const changeCampaignCredit = async (req: Request, res: Response) => {
  const { campaignId, newCredit } = req.body;
  const { userid } = req.session;

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        brand: true,
        company: {
          select: {
            subscriptions: {
              where: {
                status: 'ACTIVE',
              },
            },
            brand: true,
          },
        },
        subscription: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const subscription = campaign?.subscription || null;

    if (!subscription) return res.status(404).json({ message: 'No subscription found' });

    const subscribedCampaigns = await prisma.subscription.findFirst({
      where: {
        id: subscription.id,
      },
      select: {
        campaign: {
          select: {
            campaignCredits: true,
            shortlisted: true,
            id: true,
            name: true,
            creditsPending: true,
          },
        },
      },
    });

    const totalAssignedCredits = subscribedCampaigns?.campaign.reduce(
      (acc, cur) => acc + (cur.campaignCredits ?? 0),
      0,
    );

    if (newCredit < 0) {
      //Deduct from existing credits and add into subscription credit

      await prisma.campaign.update({
        where: {
          id: campaign.id,
        },
        data: {
          campaignCredits: {
            decrement: Math.abs(newCredit),
          },
          creditsPending: {
            decrement: Math.abs(newCredit),
          },
        },
      });
    } else {
      if (totalAssignedCredits === subscription.totalCredits) {
        // const campaigns = subscribedCampaigns?.campaign || [];

        // const newCampaigns = campaigns.map((item) => {
        //   const shortlistedCreditsAssigned = item.shortlisted.reduce((acc, cur) => acc + (cur?.ugcVideos ?? 0), 0);

        //   return {
        //     campaignId: item.id,
        //     campaignName: item.name,
        //     creditsPending: (item.campaignCredits ?? 0) - shortlistedCreditsAssigned,
        //   };
        // });

        // console.log(newCampaigns);

        return res.status(400).json({ message: 'All available credits have been used.' });
      }

      if (totalAssignedCredits + newCredit > (subscription?.totalCredits ?? 0)) {
        return res.status(400).json({
          message: `Only ${(subscription?.totalCredits ?? 0) - (totalAssignedCredits ?? 0)} credits is available to add.`,
        });
      }

      await prisma.$transaction(async (tx) => {
        const updatedCampaign = await tx.campaign.update({
          where: {
            id: campaign.id,
          },
          data: {
            campaignCredits: {
              increment: newCredit,
            },
            creditsPending: {
              increment: newCredit,
            },
          },
        });

        await tx.adminLog.create({
          data: {
            message: `${user?.name} changed the campaign credit for "${campaign.name}" from ${campaign.campaignCredits} to ${updatedCampaign.campaignCredits} credits.`,
            admin: {
              connect: {
                userId: user?.id,
              },
            },
            performedBy: user?.name,
          },
        });
      });
    }

    res.status(200).json({ message: 'Successfully changed' });
  } catch (error) {
    console.log(error);
    res.status(400).json({ message: error });
  }
};

/**
 * Syncs campaign credits based on shortlisted creators with sent agreements.
 * This recalculates creditsUtilized based on actual data and updates creditsPending accordingly.
 *
 * Formula:
 * - creditsUtilized = sum of ugcVideos for shortlisted creators (non-guest) whose agreements have been sent
 * - creditsPending = campaignCredits - creditsUtilized
 */
export const syncCampaignCredits = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        shortlisted: {
          include: {
            user: {
              include: {
                creator: { select: { isGuest: true } },
              },
            },
          },
        },
        creatorAgreement: {
          select: {
            userId: true,
            isSent: true,
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Calculate utilized credits: sum of ugcVideos for shortlisted non-guest creators with sent agreements
    // For credit tier campaigns, multiply ugcVideos by creditPerVideo
    const creditsUtilized = campaign.shortlisted.reduce((total, creator) => {
      const isGuest = creator.user?.creator?.isGuest === true;

      if (!isGuest) {
        const videos = creator.ugcVideos || 0;
        // For credit tier campaigns, multiply by creditPerVideo
        if (campaign.isCreditTier) {
          const perVideo = creator.creditPerVideo || 1;
          return total + (videos * perVideo);
        }
        return total + videos;
      }
      return total;
    }, 0);

    // Calculate pending credits
    const campaignCredits = campaign.campaignCredits || 0;
    const creditsPending = Math.max(0, campaignCredits - creditsUtilized);

    // Update campaign with synced credits
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        creditsUtilized,
        creditsPending,
      },
      select: {
        id: true,
        campaignCredits: true,
        creditsUtilized: true,
        creditsPending: true,
      },
    });

    console.log(
      `📊 Campaign credits synced for ${campaignId}: campaignCredits=${campaignCredits}, utilized=${creditsUtilized}, pending=${creditsPending}`,
    );

    return res.status(200).json({
      message: 'Credits synced successfully',
      credits: updatedCampaign,
    });
  } catch (error) {
    console.error('Error syncing campaign credits:', error);
    return res.status(500).json({ message: 'Error syncing credits', error: error.message });
  }
};

/**
 * Allows superadmin to directly update all campaign credit values.
 * This gives full control to adjust campaignCredits, creditsUtilized, and creditsPending independently.
 */
export const updateAllCampaignCredits = async (req: Request, res: Response) => {
  const { campaignId, campaignCredits, creditsUtilized, creditsPending } = req.body;
  const { userid } = req.session;

  try {
    const user = await prisma.user.findFirst({
      where: { id: userid },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        subscription: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Build update data object - only include fields that are provided
    const updateData: {
      campaignCredits?: number;
      creditsUtilized?: number;
      creditsPending?: number;
    } = {};

    if (campaignCredits !== undefined && campaignCredits !== null) {
      // Validate against subscription limits if subscription exists
      if (campaign.subscription) {
        const subscribedCampaigns = await prisma.subscription.findFirst({
          where: { id: campaign.subscription.id },
          select: {
            totalCredits: true,
            campaign: {
              select: {
                campaignCredits: true,
                id: true,
              },
            },
          },
        });

        // Calculate total assigned credits excluding current campaign
        const otherCampaignsCredits =
          subscribedCampaigns?.campaign
            .filter((c) => c.id !== campaignId)
            .reduce((acc, cur) => acc + (cur.campaignCredits ?? 0), 0) || 0;

        const totalAfterUpdate = otherCampaignsCredits + campaignCredits;

        if (totalAfterUpdate > (subscribedCampaigns?.totalCredits ?? 0)) {
          return res.status(400).json({
            message: `Cannot exceed subscription limit. Maximum available: ${(subscribedCampaigns?.totalCredits ?? 0) - otherCampaignsCredits} credits.`,
          });
        }
      }

      updateData.campaignCredits = campaignCredits;
    }

    if (creditsUtilized !== undefined && creditsUtilized !== null) {
      updateData.creditsUtilized = creditsUtilized;
    }

    if (creditsPending !== undefined && creditsPending !== null) {
      updateData.creditsPending = creditsPending;
    }

    // Perform the update in a transaction with logging
    const updatedCampaign = await prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.update({
        where: { id: campaignId },
        data: updateData,
        select: {
          id: true,
          name: true,
          campaignCredits: true,
          creditsUtilized: true,
          creditsPending: true,
        },
      });

      // Log the change
      const changes: string[] = [];
      if (updateData.campaignCredits !== undefined) {
        changes.push(`campaignCredits: ${campaign.campaignCredits} → ${updateData.campaignCredits}`);
      }
      if (updateData.creditsUtilized !== undefined) {
        changes.push(`creditsUtilized: ${campaign.creditsUtilized} → ${updateData.creditsUtilized}`);
      }
      if (updateData.creditsPending !== undefined) {
        changes.push(`creditsPending: ${campaign.creditsPending} → ${updateData.creditsPending}`);
      }

      await tx.adminLog.create({
        data: {
          message: `${user?.name} updated campaign credits for "${campaign.name}": ${changes.join(', ')}`,
          admin: {
            connect: {
              userId: user?.id,
            },
          },
          performedBy: user?.name,
        },
      });

      return updated;
    });

    console.log(`📊 Campaign credits updated by ${user?.name} for ${campaignId}`);

    return res.status(200).json({
      message: 'Credits updated successfully',
      credits: updatedCampaign,
    });
  } catch (error) {
    console.error('Error updating campaign credits:', error);
    return res.status(500).json({ message: 'Error updating credits', error: error.message });
  }
};

export const getCampaignsForPublic = async (req: Request, res: Response) => {
  const { cursor, take = 10, search } = req.query;
  const campaignId = req.query?.campaignId as string;

  try {
    const campaigns = await prisma.campaign.findMany({
      take: Number(take),
      // ...(cursor && {
      //   skip: 1,
      //   cursor: {
      //     id: campaignId ?? (cursor as string),
      //   },
      // }),
      ...(campaignId
        ? {
            cursor: { id: campaignId }, // start after this ID
          }
        : {
            ...(cursor && {
              skip: 1,
              cursor: {
                id: campaignId ?? (cursor as string),
              },
            }),
          }),
      where: {
        AND: [
          { status: 'ACTIVE' },
          {
            ...(search && {
              name: {
                contains: search as string,
                mode: 'insensitive',
              },
            }),
          },
        ],
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        bookMarkCampaign: true,
        shortlisted: true,
        logistics: {
          include: {
            reservationDetails: {
              select: {
                outlet: true,
                creatorRemarks: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (campaigns?.length === 0) {
      const data = {
        data: {
          campaigns: [],
        },
        metaData: {
          lastCursor: null,
          hasNextPage: false,
        },
      };

      return res.status(200).json(data);
    }

    // campaigns = campaigns.filter(
    //   (campaign) => campaign.campaignTimeline.find((timeline) => timeline.name === 'Open For Pitch')?.status === 'OPEN',
    // );

    // const hasNextPage = campaigns.length > Number(take);
    // const paginated = hasNextPage ? campaigns.slice(0, Number(take)) : campaigns;
    // const lastCursor = paginated.length ? paginated[paginated.length - 1].id : null;

    const lastCursor = campaigns.length > Number(take) - 1 ? campaigns[Number(take) - 1]?.id : null;

    const data = {
      data: {
        campaigns: campaigns,
      },
      metaData: {
        lastCursor,
        hasNextPage: true,
      },
    };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};
