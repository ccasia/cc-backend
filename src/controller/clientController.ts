import { Request, Response } from 'express';
import { PrismaClient, CampaignStatus, LogisticType, ReservationMode } from '@prisma/client';
import { uploadCompanyLogo, uploadAttachments } from '@configs/cloudStorage.config';
import { getRemainingCredits } from '@services/companyService';
import { clients, io } from '../server';
import { saveNotification } from './notificationController';

const prisma = new PrismaClient();

export const updateClient = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const { companyName, companyAddress, picEmail, registrationNumber, picName, picDesignation, picMobile, country } =
      JSON.parse(req.body.data);

    // Get user by role client
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        role: 'client',
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Client user not found' });
    }

    // Get client record to find the company
    const client = await prisma.client.findUnique({
      where: { userId },
      include: {
        company: {
          include: { pic: true },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    if (!client.companyId || !client.company) {
      return res.status(404).json({ message: 'Client has no associated company' });
    }

    const company = client.company;

    // Handle company logo upload
    let logoURL = company.logo;
    if (req.files && (req.files as { companyLogo: any })?.companyLogo) {
      const logo = (req.files as { companyLogo: any }).companyLogo;
      logoURL = await uploadCompanyLogo(logo.tempFilePath, logo.name);
    }

    // Prepare update data
    const userUpdateData: any = {};
    const companyUpdateData: any = {};

    // Update user data (PIC personal info)
    if (companyName) userUpdateData.name = companyName;
    if (picEmail) userUpdateData.email = picEmail;
    if (country) userUpdateData.country = country;
    if (picMobile) userUpdateData.phoneNumber = picMobile;

    // Update company data
    if (companyName) companyUpdateData.name = companyName;
    if (companyAddress) companyUpdateData.address = companyAddress;
    if (registrationNumber) companyUpdateData.registration_number = registrationNumber;
    if (logoURL !== company.logo) companyUpdateData.logo = logoURL;

    // Update PIC designation in company.pic array
    if (picDesignation && company.pic && company.pic.length > 0) {
      // Find the first PIC record for this company
      const currentPic = company.pic[0];
      if (currentPic) {
        // Update the PIC record
        await prisma.pic.update({
          where: { id: currentPic.id },
          data: {
            name: picName,
            designation: picDesignation,
            email: picEmail,
          },
        });
      }
    }

    // Execute updates in parallel
    const updatePromises = [];

    if (Object.keys(userUpdateData).length > 0) {
      updatePromises.push(
        prisma.user.update({
          where: { id: userId },
          data: userUpdateData,
        }),
      );
    }

    if (Object.keys(companyUpdateData).length > 0) {
      updatePromises.push(
        prisma.company.update({
          where: { id: company.id },
          data: companyUpdateData,
        }),
      );
    }

    const [updatedUser, updatedCompany] = await Promise.all(updatePromises);

    return res.status(200).json({
      message: 'Client profile updated successfully',
      data: {
        user: updatedUser,
        company: updatedCompany,
      },
    });
  } catch (error: any) {
    console.error('Error updating client profile:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while updating client profile',
    });
  }
};

export const checkClientCompany = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const client = await prisma.client.findUnique({
      where: { userId },
      include: {
        company: {
          include: {
            pic: true,
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    return res.status(200).json({
      hasCompany: !!client.companyId,
      company: client.company,
    });
  } catch (error: any) {
    console.error('Error checking client company:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while checking client company',
    });
  }
};

export const createClientCompany = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const { picName, registrationNumber, companyAddress, picDesignation, picNumber, country } = req.body;

    if (!picName) {
      return res.status(400).json({ message: 'PIC name is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, role: 'client' },
    });

    if (!user) {
      return res.status(404).json({ message: 'Client user not found' });
    }

    const client = await prisma.client.findUnique({
      where: { userId },
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    if (client.companyId) {
      return res.status(400).json({ message: 'Client already has a company' });
    }

    const company = await prisma.company.create({
      data: {
        name: user.name || picName,
        email: user.email,
        address: companyAddress,
        registration_number: registrationNumber,
        pic: {
          create: {
            name: picName || `${picDesignation} of ${user.name}`,
            email: user.email,
            designation: picDesignation || 'PIC',
          },
        },
      },
      include: {
        pic: true,
      },
    });

    await prisma.client.update({
      where: { userId },
      data: { companyId: company.id },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        country,
        phoneNumber: picNumber,
      },
    });

    return res.status(201).json({
      message: 'Company created successfully',
      company: {
        id: company.id,
        name: company.name,
        registration_number: company.registration_number,
        pic: {
          name: company.pic[0].name,
          email: company.pic[0].email,
          designation: company.pic[0].designation,
        },
      },
    });
  } catch (error: any) {
    console.error('Error creating client company:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while creating company',
    });
  }
};

export const createClientCampaign = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if the user is a client
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        role: 'client',
      },
      include: {
        client: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!user || !user.client) {
      return res.status(403).json({ message: 'Only client users can create client campaigns' });
    }

    // Parse form data
    let campaignData;
    try {
      // Check if data exists and is a string before parsing
      if (!req.body.data) {
        return res.status(400).json({ message: 'Missing campaign data' });
      }

      campaignData = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data; // If it's already an object, use it directly
    } catch (error) {
      console.error('Error parsing campaign data:', error, 'Raw data:', req.body.data);
      return res.status(400).json({ message: 'Invalid campaign data format' });
    }

    const {
      campaignTitle,
      campaignDescription,
      campaignStartDate,
      campaignEndDate,
      postingStartDate,
      postingEndDate,
      campaignCredits,
      brandTone,
      brandAbout,
      productName,
      websiteLink,
      campaignIndustries,
      campaignObjectives,
      secondaryObjectives,
      boostContent,
      primaryKPI,
      performanceBaseline,
      audienceGender,
      audienceAge,
      audienceLocation,
      audienceLanguage,
      audienceCreatorPersona,
      audienceUserPersona,
      country,
      secondaryAudienceGender,
      secondaryAudienceAge,
      secondaryAudienceLocation,
      secondaryAudienceLanguage,
      secondaryAudienceCreatorPersona,
      secondaryAudienceUserPersona,
      secondaryCountry,
      geographicFocus,
      geographicFocusOthers,
      campaignDo,
      campaignDont,
      referencesLinks,
      logisticsType,
      products,
      schedulingOption,
      locations,
      availabilityRules,
      logisticRemarks,
      clientRemarks,
      allowMultipleBookings,
      // Additional Details 1 fields
      socialMediaPlatform,
      contentFormat,
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
    } = campaignData;

    // Validate required fields
    if (!campaignTitle || !campaignDescription) {
      return res.status(400).json({ message: 'Campaign title and description are required' });
    }

    // Check if client has a company
    if (!user.client.companyId) {
      return res.status(400).json({ message: 'Client must be associated with a company to create campaigns' });
    }

    const company = user.client.company;

    // Check available credits before creating campaign
    if (!company) {
      return res.status(400).json({ message: 'Client company not found' });
    }

    const availableCredits = await getRemainingCredits(company.id);

    // Ensure availableCredits is a valid number
    if (availableCredits === null || typeof availableCredits !== 'number') {
      return res.status(400).json({ message: 'Unable to retrieve available credits for the client' });
    }

    // Check if campaignCredits exceed availableCredits
    const requestedCredits = campaignCredits ? Number(campaignCredits) : 0;
    if (requestedCredits > availableCredits) {
      return res.status(400).json({
        message: `Not enough credits to create the campaign. Available: ${availableCredits}, Requested: ${requestedCredits}`,
      });
    }

    // Generate campaign ID
    const campaignId = `C${Math.floor(Math.random() * 1000)}`;

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

    const otherAttachments: string[] = [];
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

    const newCampaign = await prisma.$transaction(async (tx) => {
      // --- LOGISTICS: Process Products ---
      let productsToCreate: any[] = [];
      if (logisticsType === 'PRODUCT_DELIVERY' && Array.isArray(products)) {
        productsToCreate = products
          .filter((product: any) => product.name && product.name.trim() !== '')
          .map((product: any) => ({ productName: product.name }));
      }

      // --- LOGISTICS: Process Reservations ---
      let reservationConfigCreate = undefined;
      if (logisticsType === 'RESERVATION') {
        const mode: ReservationMode = schedulingOption === 'auto' ? 'AUTO_SCHEDULE' : 'MANUAL_CONFIRMATION';

        // Flatten locations
        const locationNames = Array.isArray(locations)
          ? locations.filter((loc: any) => loc.name && loc.name.trim() !== '')
          : [];

        reservationConfigCreate = {
          create: {
            mode,
            locations: locationNames as any,
            availabilityRules: availabilityRules as any,
            clientRemarks: clientRemarks || null,
            allowMultipleBookings: allowMultipleBookings || false,
          },
        };
      }

      // Construct Objectives String (including remarks)
      let objectivesString = campaignObjectives || '';
      if (logisticRemarks) {
        objectivesString += `\n\n[Logistic Remarks]: ${logisticRemarks}`;
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

      // Create campaign with PENDING status
      const campaign = await tx.campaign.create({
        data: {
          campaignId,
          name: campaignTitle,
          description: campaignDescription,
          status: 'PENDING_CSM_REVIEW',
          origin: 'CLIENT',
          submissionVersion: 'v4',
          brandTone: brandTone || '',
          brandAbout: brandAbout || '',
          productName: productName || '',
          websiteLink: websiteLink || '',
          products: {
            create: productsToCreate,
          },
          reservationConfig: reservationConfigCreate,
          logisticsType: logisticsType && logisticsType !== '' ? (logisticsType as LogisticType) : null,

          campaignBrief: {
            create: {
              title: campaignTitle,
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
              industries: campaignIndustries ? campaignIndustries.join(', ') : '',
              socialMediaPlatform: Array.isArray(socialMediaPlatform) ? socialMediaPlatform : [],
              campaigns_do: campaignDo || [],
              campaigns_dont: campaignDont || [],
              otherAttachments: otherAttachments,
              referencesLinks: referencesLinks?.map((link: any) => link?.value).filter(Boolean) || [],
            },
          },
          campaignRequirement: {
            create: {
              // Primary Audience
              gender: audienceGender || [],
              age: audienceAge || [],
              country: finalizedCountries[0] || country || '',
              countries: finalizedCountries,
              language: audienceLanguage || [],
              creator_persona: audienceCreatorPersona || [],
              user_persona: audienceUserPersona || '',
              // Secondary Audience
              secondary_gender: secondaryAudienceGender || [],
              secondary_age: secondaryAudienceAge || [],
              secondary_geoLocation: secondaryAudienceLocation || [],
              secondary_language: secondaryAudienceLanguage || [],
              secondary_creator_persona: secondaryAudienceCreatorPersona || [],
              secondary_user_persona: secondaryAudienceUserPersona || '',
              secondary_country: secondaryCountry || '',
              geographic_focus: geographicFocus || '',
              geographicFocusOthers: geographicFocusOthers || '',
            },
          },
          campaignCredits: requestedCredits,
          creditsPending: requestedCredits,
          creditsUtilized: 0,
          company: {
            connect: {
              id: company?.id || '',
            },
          },
        },
        include: {
          campaignBrief: true,
          campaignRequirement: true,
          products: true,
          reservationConfig: true,
        },
      });

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

      // FIFO credit deduction logic
      if (requestedCredits > 0) {
        // Deduct credits from subscription
        const activeSubscriptions = await tx.subscription.findMany({
          where: {
            companyId: company?.id || '',
            status: 'ACTIVE',
          },
          orderBy: { expiredAt: 'asc' },
        });

        // if (activeSubscription && requestedCredits > 0) {
        //   await prisma.subscription.update({
        //     where: {
        //       id: activeSubscription.id,
        //     },
        //     data: {
        //       creditsUsed: {
        //         increment: requestedCredits,
        //       },
        //     },
        //   });
        // }
        let creditsToDeduct = requestedCredits;

        for (const sub of activeSubscriptions) {
          if (creditsToDeduct <= 0) break;

          const remainingInSub = (sub.totalCredits || 0) - sub.creditsUsed;
          const deductionAmount = Math.min(creditsToDeduct, remainingInSub);

          if (deductionAmount > 0) {
            await tx.subscription.update({
              where: { id: sub.id },
              data: { creditsUsed: { increment: deductionAmount } },
            });
            creditsToDeduct -= deductionAmount;
          }
        }
      }

      // Add the client to campaignAdmin so they can see it in their dashboard
      await tx.campaignAdmin.create({
        data: {
          adminId: userId,
          campaignId: campaign.id,
        },
      });

      // Add all other clients from the same company to campaignAdmin
      const otherClientsInCompany = await tx.user.findMany({
        where: {
          client: {
            companyId: company?.id || '',
          },
          id: {
            not: userId, // Exclude the current user as they're already added
          },
        },
      });

      console.log(`Found ${otherClientsInCompany.length} other clients in the same company`);

      // Add each client to campaignAdmin
      for (const clientUser of otherClientsInCompany) {
        try {
          await prisma.campaignAdmin.create({
            data: {
              adminId: clientUser.id,
              campaignId: campaign.id,
            },
          });
          console.log(`Added client ${clientUser.id} to campaign ${campaign.id}`);
        } catch (error) {
          console.error(`Error adding client ${clientUser.id} to campaign:`, error);
          // Continue with other clients even if one fails
        }
      }

      // Create a campaign log entry to track that this client created the campaign
      await tx.campaignLog.create({
        data: {
          message: `Campaign Created`,
          adminId: userId,
          campaignId: campaign.id,
        },
      });

      return campaign;
    });

    // Select CSL and superadmin for notification
    const usersToNotify = await prisma.user.findMany({
      where: {
        OR: [
          { role: 'superadmin' },
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
      },
    });

    if (usersToNotify.length > 0) {
      for (const adminUser of usersToNotify) {
        const notification = await saveNotification({
          userId: adminUser.id,
          title: '🚨 Fresh Campaign Brief just landed. Review and assign CS to start. ',
          message: `Client ${user.name || 'Unknown'} has created a new campaign: ${campaignTitle}`,
          entity: 'Campaign',
          entityId: newCampaign.id,
          campaignId: newCampaign.id,
        });
        const socketId = clients.get(adminUser.id);

        if (socketId) {
          io.to(socketId).emit('notification', notification);
          console.log(`Sent real-time notification to user ${adminUser.id} on socket ${socketId}`);
        }
      }
    }

    return res.status(201).json({
      message: 'Client campaign created successfully and is pending CSM review',
      campaign: {
        id: newCampaign.id,
        campaignId: newCampaign.campaignId,
        name: newCampaign.name,
        status: newCampaign.status,
      },
    });
  } catch (error: any) {
    console.error('Error creating client campaign:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while creating client campaign',
    });
  }
};

export const createClientRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if user exists and has client role
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        role: 'client',
      },
      include: {
        client: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Client user not found' });
    }

    // If client record already exists, return it
    if (user.client) {
      return res.status(200).json({
        message: 'Client record already exists',
        client: user.client,
      });
    }

    // Create client record
    const client = await prisma.client.create({
      data: {
        userId: userId,
        // No company yet - user will need to create one separately
      },
    });

    return res.status(201).json({
      message: 'Client record created successfully',
      client,
    });
  } catch (error: any) {
    console.error('Error creating client record:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while creating client record',
    });
  }
};

export const createClientWithCompany = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if user exists and has client role
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        role: 'client',
      },
      include: {
        client: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Client user not found' });
    }

    // Create client record if it doesn't exist
    let client = user.client;
    if (!client) {
      client = await prisma.client.create({
        data: {
          userId: userId,
        },
      });
    }

    // Check if client already has a company
    if (client.companyId) {
      return res.status(200).json({
        message: 'Client already has a company',
        clientId: client.id,
        companyId: client.companyId,
      });
    }

    // Create a company for the client using the user's name as company name
    const company = await prisma.company.create({
      data: {
        name: user.name || 'Client Company',
        email: user.email,
        address: '',
        registration_number: '',
        pic: {
          create: {
            name: user.name || 'Client PIC',
            email: user.email,
            designation: 'Owner',
          },
        },
      },
      include: {
        pic: true,
      },
    });

    // Associate the company with the client
    await prisma.client.update({
      where: { userId },
      data: { companyId: company.id },
    });

    return res.status(201).json({
      message: 'Company created and associated with client successfully',
      client: {
        id: client.id,
        companyId: company.id,
      },
      company: {
        id: company.id,
        name: company.name,
        email: company.email,
      },
    });
  } catch (error: any) {
    console.error('Error creating client with company:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while creating client with company',
    });
  }
};
