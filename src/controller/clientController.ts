import { Request, Response } from 'express';
import { PrismaClient, CampaignStatus } from '@prisma/client';
import { uploadCompanyLogo } from '@configs/cloudStorage.config';
import { getRemainingCredits } from '@services/companyService';

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
            email: picEmail 
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
      
      campaignData = typeof req.body.data === 'string' 
        ? JSON.parse(req.body.data) 
        : req.body.data; // If it's already an object, use it directly
    } catch (error) {
      console.error('Error parsing campaign data:', error, 'Raw data:', req.body.data);
      return res.status(400).json({ message: 'Invalid campaign data format' });
    }

    const {
      campaignTitle,
      campaignDescription,
      campaignStartDate,
      campaignEndDate,
      campaignCredits,
      brandTone,
      productName,
      campaignIndustries,
      campaignObjectives,
      audienceGender,
      audienceAge,
      audienceLocation,
      audienceLanguage,
      audienceCreatorPersona,
      audienceUserPersona,
      socialMediaPlatform,
      videoAngle,
      campaignDo,
      campaignDont,
      // submissionVersion,
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
        message: `Not enough credits to create the campaign. Available: ${availableCredits}, Requested: ${requestedCredits}` 
      });
    }

    // Generate campaign ID
    const campaignId = `C${Math.floor(Math.random() * 1000)}`;

    // Process uploaded images
    let publicURL: string[] = [];
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

    // Create campaign with PENDING status
    const campaign = await prisma.campaign.create({
      data: {
        campaignId,
        name: campaignTitle,
        description: campaignDescription,
        status: 'PENDING_CSM_REVIEW', // Set to PENDING_CSM_REVIEW so it shows up in the Pending tab for admins
        origin: 'CLIENT', // Mark as client-created campaign for v3 flow
        submissionVersion: 'v4', 
        brandTone: brandTone || '',
        productName: productName || '',
        // Skip adminManager and other fields that will be set by CSM later
        campaignBrief: {
          create: {
            title: campaignTitle,
            objectives: campaignObjectives ? campaignObjectives.join(', ') : '',
            images: publicURL,
            startDate: campaignStartDate ? new Date(campaignStartDate) : new Date(),
            endDate: campaignEndDate ? new Date(campaignEndDate) : new Date(),
            industries: campaignIndustries ? campaignIndustries.join(', ') : '',
            campaigns_do: campaignDo || [],
            campaigns_dont: campaignDont || [],
            videoAngle: videoAngle || [],
            socialMediaPlatform: socialMediaPlatform || [],
          },
        },
        campaignRequirement: {
          create: {
            gender: audienceGender || [],
            age: audienceAge || [],
            geoLocation: audienceLocation || [],
            language: audienceLanguage || [],
            creator_persona: audienceCreatorPersona || [],
            user_persona: audienceUserPersona || '',
          },
        },
        campaignCredits: requestedCredits,
        creditsPending: requestedCredits,
        creditsUtilized: 0,
        // Connect to client's company
        company: {
          connect: {
            id: company?.id || '',
          },
        },
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
      },
    });

    // Deduct credits from subscription
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        companyId: company?.id || '',
        status: 'ACTIVE',
      },
    });

    if (activeSubscription && requestedCredits > 0) {
      await prisma.subscription.update({
        where: {
          id: activeSubscription.id,
        },
        data: {
          creditsUsed: {
            increment: requestedCredits,
          },
        },
      });
    }
    
    // Add the client to campaignAdmin so they can see it in their dashboard
    await prisma.campaignAdmin.create({
      data: {
        adminId: userId,
        campaignId: campaign.id,
      },
    });
    
    // Add all other clients from the same company to campaignAdmin
    const otherClientsInCompany = await prisma.user.findMany({
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
    await prisma.campaignLog.create({
      data: {
        message: `Campaign created by client ${user.name || user.id}`,
        adminId: userId,
        campaignId: campaign.id,
      },
    });

    // Create a notification for CSM users about the new client campaign
    await prisma.notification.create({
      data: {
        title: 'New Client Campaign',
        message: `Client ${user.name || 'Unknown'} has created a new campaign: ${campaignTitle}`,
        entity: 'Campaign',
        campaignId: campaign.id,
        // This notification will be sent to all CSM users
        // You'll need to implement logic to determine which CSM users should receive it
      },
    });

    return res.status(201).json({
      message: 'Client campaign created successfully and is pending CSM review',
      campaign: {
        id: campaign.id,
        campaignId: campaign.campaignId,
        name: campaign.name,
        status: campaign.status,
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
        role: 'client'
      },
      include: {
        client: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'Client user not found' });
    }

    // If client record already exists, return it
    if (user.client) {
      return res.status(200).json({ 
        message: 'Client record already exists',
        client: user.client
      });
    }

    // Create client record
    const client = await prisma.client.create({
      data: {
        userId: userId,
        // No company yet - user will need to create one separately
      }
    });

    return res.status(201).json({
      message: 'Client record created successfully',
      client
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
        role: 'client'
      },
      include: {
        client: true
      }
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
        }
      });
    }

    // Check if client already has a company
    if (client.companyId) {
      return res.status(200).json({ 
        message: 'Client already has a company',
        clientId: client.id,
        companyId: client.companyId
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
        companyId: company.id
      },
      company: {
        id: company.id,
        name: company.name,
        email: company.email
      }
    });
  } catch (error: any) {
    console.error('Error creating client with company:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while creating client with company',
    });
  }
};
