import dayjs from 'dayjs';
import { Request, Response } from 'express';
import jwt, { Secret } from 'jsonwebtoken';
import { generateRandomString } from '@utils/randomString';
import { uploadCompanyLogo } from '@configs/cloudStorage.config';
import { prisma } from '../prisma/prisma';

const DEMO_TOKEN_LENGTH = 32;

const TRUSTED_CLIENT_DEMO_ORIGINS = new Set([
  'https://app.cultcreativeasia.com',
  'https://staging.cultcreativeasia.com',
  'http://localhost',
  'http://localhost:3030',
]);

const normalizeOrigin = (origin?: string) => origin?.trim().replace(/\/$/, '');

const isTrustedDemoOrigin = (origin: string) => {
  if (TRUSTED_CLIENT_DEMO_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname) &&
      ['', '3030'].includes(url.port)
    );
  } catch {
    return false;
  }
};

const getTrustedDemoOrigin = (req: Request) => {
  const origin = normalizeOrigin(req.get('origin'));

  return origin && isTrustedDemoOrigin(origin) ? origin : null;
};

const sendUntrustedDemoOriginResponse = (res: Response) => {
  return res.status(403).json({ message: 'Demo links can only be generated from a trusted frontend origin' });
};

const getDemoUrl = (origin: string, token: string) => {
  return `${origin}/client-demo/${token}`;
};

const generateUniqueDemoToken = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateRandomString(DEMO_TOKEN_LENGTH);
    const clash = await prisma.client.findUnique({ where: { demoAccessToken: token } });
    if (!clash) return token;
  }

  throw new Error('Could not generate a unique demo token after 5 attempts');
};

export const createClientDemo = async (req: Request, res: Response) => {
  const rawName = String(req.body?.name || '').trim();
  if (!rawName) return res.status(400).json({ message: 'Demo client name is required' });

  const demoOrigin = getTrustedDemoOrigin(req);
  if (!demoOrigin) return sendUntrustedDemoOriginResponse(res);

  try {
    const demoAccessToken = await generateUniqueDemoToken();
    const demoEmail = `demo+${demoAccessToken.toLowerCase()}@cultcreativeasia.com`;

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: rawName,
          email: demoEmail,
          type: 'directClient',
          pic: {
            create: {
              name: rawName,
              email: demoEmail,
              designation: 'Demo Client',
            },
          },
        },
      });

      const user = await tx.user.create({
        data: {
          email: demoEmail,
          password: '',
          role: 'client_demo',
          status: 'active',
          isActive: true,
          isVerified: true,
          name: rawName,
        },
      });

      const client = await tx.client.create({
        data: {
          userId: user.id,
          companyId: company.id,
          clientType: 'demoClient',
          demoAccessToken,
        },
      });

      return { company, user, client };
    });

    return res.status(201).json({
      message: 'Client demo created',
      companyId: result.company.id,
      clientId: result.client.id,
      userId: result.user.id,
      name: result.company.name,
      token: demoAccessToken,
      url: getDemoUrl(demoOrigin, demoAccessToken),
    });
  } catch (error: any) {
    console.error('createClientDemo error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to create client demo' });
  }
};

export const getClientDemoLinkByCompany = async (req: Request, res: Response) => {
  const companyId = String(req.params.companyId || '').trim();
  if (!companyId) return res.status(400).json({ message: 'companyId is required' });

  const demoOrigin = getTrustedDemoOrigin(req);
  if (!demoOrigin) return sendUntrustedDemoOriginResponse(res);

  try {
    const client = await prisma.client.findFirst({
      where: {
        companyId,
        clientType: 'demoClient',
        demoAccessToken: { not: null },
      },
      include: {
        company: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, role: true, status: true } },
      },
    });

    if (!client?.demoAccessToken) {
      return res.status(404).json({ message: 'Demo link not found' });
    }

    return res.status(200).json({
      companyId: client.companyId,
      clientId: client.id,
      userId: client.userId,
      name: client.company?.name || client.user.name,
      token: client.demoAccessToken,
      url: getDemoUrl(demoOrigin, client.demoAccessToken),
    });
  } catch (error: any) {
    console.error('getClientDemoLinkByCompany error:', error);
    return res.status(500).json({ message: 'Failed to fetch demo link' });
  }
};

export const regenerateClientDemoLink = async (req: Request, res: Response) => {
  const companyId = String(req.params.companyId || '').trim();
  if (!companyId) return res.status(400).json({ message: 'companyId is required' });

  const demoOrigin = getTrustedDemoOrigin(req);
  if (!demoOrigin) return sendUntrustedDemoOriginResponse(res);

  try {
    const client = await prisma.client.findFirst({
      where: {
        companyId,
        clientType: 'demoClient',
        demoAccessToken: { not: null },
      },
      include: {
        company: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Demo link not found' });
    }

    // Rotate only the access token. The old URL/QR stop working immediately
    // because the session lookup matches on demoAccessToken. IDs and the demo
    // email are intentionally left untouched.
    const demoAccessToken = await generateUniqueDemoToken();

    const updated = await prisma.client.update({
      where: { id: client.id },
      data: { demoAccessToken },
      select: { id: true, userId: true, companyId: true },
    });

    return res.status(200).json({
      companyId: updated.companyId,
      clientId: updated.id,
      userId: updated.userId,
      name: client.company?.name || client.user?.name,
      token: demoAccessToken,
      url: getDemoUrl(demoOrigin, demoAccessToken),
    });
  } catch (error: any) {
    console.error('regenerateClientDemoLink error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to regenerate demo link' });
  }
};

// Creates a campaign for a demo session. Fully isolated from the real
// Campaign/credit system: no credit checks, no subscription writes, no file
// uploads. Saves only a DemoCampaign row (core fields + full payload snapshot).
export const createDemoCampaign = async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { client: true },
    });

    if (
      !user ||
      user.role !== 'client_demo' ||
      !user.client ||
      user.client.clientType !== 'demoClient'
    ) {
      return res.status(403).json({ message: 'Only demo clients can create demo campaigns' });
    }

    if (!user.client.companyId) {
      return res.status(400).json({ message: 'Demo client is not associated with a company' });
    }

    // Parse the form payload (same shape the client campaign form sends).
    let campaignData: any;
    try {
      if (!req.body?.data) {
        return res.status(400).json({ message: 'Missing campaign data' });
      }
      campaignData =
        typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
    } catch (error) {
      return res.status(400).json({ message: 'Invalid campaign data format' });
    }

    const { campaignTitle, campaignDescription, campaignStartDate, campaignEndDate } = campaignData;

    if (!campaignTitle || !campaignDescription) {
      return res.status(400).json({ message: 'Campaign title and description are required' });
    }

    const industries = Array.isArray(campaignData.campaignIndustries)
      ? campaignData.campaignIndustries
      : [];

    const status =
      campaignStartDate && dayjs(campaignStartDate).isSame(dayjs(), 'date') ? 'ACTIVE' : 'SCHEDULED';

    // Upload the campaign image(s) to GCS and persist their URLs in the snapshot.
    const imageUrls: string[] = [];
    if (req.files && (req.files as any).campaignImages) {
      const images = Array.isArray((req.files as any).campaignImages)
        ? (req.files as any).campaignImages
        : [(req.files as any).campaignImages];

      for (const image of images) {
        try {
          const url = await uploadCompanyLogo(image.tempFilePath, image.name);
          imageUrls.push(url);
        } catch (uploadError) {
          console.error('createDemoCampaign image upload error:', uploadError);
        }
      }
    }
    campaignData.campaignImages = imageUrls;

    const demoCampaign = await prisma.demoCampaign.create({
      data: {
        name: campaignTitle,
        description: campaignDescription,
        industry: industries[0] || null,
        startDate: campaignStartDate ? new Date(campaignStartDate) : null,
        endDate: campaignEndDate ? new Date(campaignEndDate) : null,
        status,
        userId: user.id,
        clientId: user.client.id,
        companyId: user.client.companyId,
        data: campaignData,
      },
    });

    return res.status(201).json({ message: 'Demo campaign created', campaign: demoCampaign });
  } catch (error: any) {
    console.error('createDemoCampaign error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to create demo campaign' });
  }
};

// Maps the flat client-form snapshot stored on a DemoCampaign into the deeply
// nested `campaign` shape the client campaign-details page expects. Every array
// a client tab iterates is populated (empty) so the read-only view never crashes.
const mapDemoCampaignToCampaignShape = (demo: any, company: any) => {
  const data = (demo.data || {}) as any;
  const industries = Array.isArray(data.campaignIndustries) ? data.campaignIndustries : [];
  const images = Array.isArray(data.campaignImages) ? data.campaignImages : [];

  return {
    id: demo.id,
    name: data.campaignTitle || demo.name,
    description: data.campaignDescription || demo.description || '',
    status: demo.status,
    origin: 'ADMIN',
    submissionVersion: 'v2',
    campaignCredits: null,
    creditsUtilized: null,
    creditsPending: null,
    isCreditTier: false,
    productName: data.productName || '',
    brandAbout: data.brandAbout || '',
    websiteLink: data.websiteLink || '',
    logisticsType: data.logisticsType || null,

    rawFootage: false,
    photos: false,
    ads: false,
    crossPosting: false,

    campaignBrief: {
      images,
      startDate: demo.startDate,
      endDate: demo.endDate,
      postingStartDate: data.postingStartDate || null,
      postingEndDate: data.postingEndDate || null,
      objectives: data.campaignObjectives || '',
      secondaryObjectives: Array.isArray(data.secondaryObjectives) ? data.secondaryObjectives : [],
      boostContent: data.boostContent || '',
      primaryKPI: data.primaryKPI || '',
      performanceBaseline: data.performanceBaseline || '',
      socialMediaPlatform: Array.isArray(data.socialMediaPlatform) ? data.socialMediaPlatform : [],
      industries: industries.join(', '),
      referencesLinks: [],
      otherAttachments: [],
    },

    campaignRequirement: {
      gender: Array.isArray(data.audienceGender) ? data.audienceGender : [],
      age: Array.isArray(data.audienceAge) ? data.audienceAge : [],
      country: data.country || '',
      language: Array.isArray(data.audienceLanguage) ? data.audienceLanguage : [],
      creator_persona: Array.isArray(data.audienceCreatorPersona) ? data.audienceCreatorPersona : [],
      user_persona: data.audienceUserPersona || '',
      geographic_focus: data.geographicFocus || '',
      geographicFocusOthers: data.geographicFocusOthers || '',
      secondary_gender: Array.isArray(data.secondaryAudienceGender)
        ? data.secondaryAudienceGender
        : [],
      secondary_age: Array.isArray(data.secondaryAudienceAge) ? data.secondaryAudienceAge : [],
      secondary_country: data.secondaryCountry || '',
      secondary_language: Array.isArray(data.secondaryAudienceLanguage)
        ? data.secondaryAudienceLanguage
        : [],
      secondary_creator_persona: Array.isArray(data.secondaryAudienceCreatorPersona)
        ? data.secondaryAudienceCreatorPersona
        : [],
      secondary_user_persona: data.secondaryAudienceUserPersona || '',
    },

    campaignAdditionalDetails: {
      contentFormat: Array.isArray(data.contentFormat) ? data.contentFormat : [],
      mainMessage: data.mainMessage || '',
      keyPoints: data.keyPoints || '',
      toneAndStyle: data.toneAndStyle || '',
      brandGuidelinesUrl: null,
      referenceContent: data.referenceContent || '',
      productImage1Url: null,
      productImage2Url: null,
      hashtagsToUse: data.hashtagsToUse || '',
      mentionsTagsRequired: data.mentionsTagsRequired || '',
      creatorCompensation: data.creatorCompensation || '',
      ctaDesiredAction: data.ctaDesiredAction || '',
      ctaLinkUrl: data.ctaLinkUrl || '',
      ctaPromoCode: data.ctaPromoCode || '',
      ctaLinkInBioRequirements: data.ctaLinkInBioRequirements || '',
      specialNotesInstructions: data.specialNotesInstructions || '',
      needAds: data.needAds || '',
    },

    company: {
      id: company?.id || demo.companyId,
      name: company?.name || '',
      logo: null,
      about: data.brandAbout || company?.about || '',
      address: null,
      website: data.websiteLink || null,
      pic: [],
      subscriptions: [],
    },
    brand: null,

    // Empty collections — every client tab iterates these.
    pitch: [],
    shortlisted: [],
    submission: [],
    campaignClients: [],
    campaignAdmin: [],
    campaignTimeline: [],
    logistics: [],
  };
};

export const getDemoCampaignById = async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const id = String(req.params.id || '').trim();
  if (!id) {
    return res.status(400).json({ message: 'Campaign id is required' });
  }

  try {
    const client = await prisma.client.findFirst({
      where: { userId, clientType: 'demoClient' },
      select: { id: true },
    });

    if (!client) {
      return res.status(403).json({ message: 'Demo client not found' });
    }

    const demo = await prisma.demoCampaign.findFirst({
      where: { id, clientId: client.id },
    });

    if (!demo) {
      return res.status(404).json({ message: 'Demo campaign not found' });
    }

    const company = await prisma.company.findUnique({
      where: { id: demo.companyId },
      select: { id: true, name: true, about: true },
    });

    return res.status(200).json(mapDemoCampaignToCampaignShape(demo, company));
  } catch (error: any) {
    console.error('getDemoCampaignById error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to fetch demo campaign' });
  }
};

export const listDemoCampaigns = async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const client = await prisma.client.findFirst({
      where: { userId, clientType: 'demoClient' },
      select: { id: true },
    });

    if (!client) {
      return res.status(403).json({ message: 'Demo client not found' });
    }

    const campaigns = await prisma.demoCampaign.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json(campaigns);
  } catch (error: any) {
    console.error('listDemoCampaigns error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to fetch demo campaigns' });
  }
};

export const createClientDemoSession = async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(404).json({ message: 'Not found' });

  try {
    const client = await prisma.client.findUnique({
      where: { demoAccessToken: token },
      include: {
        user: true,
        company: true,
      },
    });

    if (
      !client ||
      !client.user ||
      client.user.role !== 'client_demo' ||
      client.clientType !== 'demoClient' ||
      client.user.status !== 'active'
    ) {
      return res.status(404).json({ message: 'This demo link is no longer valid' });
    }

    const accessToken = jwt.sign(
      { userId: client.user.id, email: client.user.email },
      process.env.ACCESSKEY as Secret,
      {
        expiresIn: '4h',
      },
    );
    const refreshToken = jwt.sign(
      { userId: client.user.id, email: client.user.email },
      process.env.REFRESHKEY as Secret,
    );

    const session = req.session as any;
    session.userid = client.user.id;
    session.refreshToken = refreshToken;
    session.role = client.user.role;
    session.name = client.user.name || '';
    session.photoURL = client.user.photoURL || '';

    res.cookie('userid', client.user.id, {
      maxAge: 60 * 60 * 24 * 1000,
      httpOnly: true,
    });

    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000,
      httpOnly: true,
    });

    return res.status(200).json({
      message: 'Demo session created',
      accessToken,
      user: {
        id: client.user.id,
        email: client.user.email,
        name: client.user.name,
        role: client.user.role,
        status: client.user.status,
        client: {
          id: client.id,
          companyId: client.companyId,
          clientType: client.clientType,
          company: client.company,
        },
      },
    });
  } catch (error: any) {
    console.error('createClientDemoSession error:', error);
    return res.status(500).json({ message: 'Failed to start demo session' });
  }
};
