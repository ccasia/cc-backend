import {
  PrismaClient,
  RoleEnum,
  Status,
  CampaignStatus,
  CampaignOrigin,
  SubscriptionChangeType,
  FlowType,
  StepStatus,
  NpsUserType,
  SubmissionStatus,
  PitchStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const REJECTION_REASONS = [
  'Engagement Rate Too Low',
  'Does Not Fit Criteria in Campaign Brief',
  'Content is Not Fit for the Campaign',
  'Others',
];

const SKIPPABLE_FIELDS = [
  'secondary_audience',
  'brand_guidelines',
  'competitor_links',
  'mood_board',
  'social_media_handles',
];

const STEPS = [
  'GENERAL_CAMPAIGN_INFORMATION',
  'CAMPAIGN_OBJECTIVES',
  'TARGET_AUDIENCE',
  'LOGISTICS__OPTIONAL_',
  'RESERVATION_SLOTS',
  'ADDITIONAL_LOGISTIC_REMARKS',
  'NEXT_STEPS',
  'ADDITIONAL_DETAILS_1',
  'ADDITIONAL_DETAILS_2',
];

const CREATOR_STEPS = ['PROFILE', 'SOCIAL_MEDIA', 'INTERESTS', 'PAYMENT_INFO', 'REVIEW'];

const PRONOUNS = ['he/him', 'she/her', 'they/them'];

const CREATOR_NAMES = [
  'Aisha Rahman',
  'Darren Tan',
  'Priya Nair',
  'Kai Lim',
  'Siti Aminah',
  'Jordan Lee',
  'Nurul Huda',
  'Ryan Ong',
  'Mei Ling',
  'Farhan Ali',
  'Chloe Wong',
  'Izzat Hakim',
  'Sarah Chen',
  'Amir Syafiq',
  'Diana Yap',
  'Haziq Roslan',
  'Fiona Tan',
  'Arif Ismail',
  'Jasmine Kaur',
  'Zack Liew',
  'Hana Binti',
  'Ethan Goh',
  'Lily Tan',
  'Omar Zain',
  'Rina Suzuki',
  'Adam Khoo',
  'Nina Patel',
  'Hafiz Shah',
  'Emma Lau',
  'Tengku Amin',
  'Yuki Sato',
  'Ben Teo',
  'Anisa Wahab',
  'Lucas Ng',
  'Dina Rosli',
  'Ivan Chong',
  'Mira Das',
  'Faiz Abdullah',
  'Tina Koh',
  'Reza Mahmood',
  'Grace Low',
  'Shafiq Hamid',
  'Vanessa Sim',
  'Imran Yusof',
  'Clara Foo',
  'Nizam Aziz',
  'Penny Lim',
  'Harun Idris',
  'Stella Ang',
  'Kamal Rashid',
];

const BRAND_NAMES = [
  'Glow Skincare',
  'FreshBite Foods',
  'UrbanPulse Fashion',
  'TechNova',
  'PureLeaf Tea',
  'VeloCity Sports',
  'Lumière Beauty',
  'CraftBrew Co',
  'EcoNest Living',
  'SoundWave Audio',
  'BloomBox Florals',
  'SnapFit Gym',
  'CloudKitchen MY',
  'Petite Luxe',
  'GreenGrind Coffee',
  'ByteSize Tech',
  'HerbalRoot Wellness',
  'StreetStyle KL',
  'AquaPure Water',
  'FusionBites',
];

const CAMPAIGN_PREFIXES = [
  'CNY 2025',
  'Raya Collection',
  'Summer Vibes',
  'Back to School',
  'Year End Sale',
  'Valentine Special',
  'Merdeka Drop',
  'Christmas Promo',
  'Spring Launch',
  'Hari Raya Haji',
  'Mid-Year Clearance',
  'Product Launch',
  'Brand Awareness',
  'Influencer Collab',
  'Viral Challenge',
  'Unboxing Series',
  'Review Campaign',
  'Lifestyle Shoot',
  'Recipe Series',
  'Fitness Journey',
];

const ADMIN_NAMES = ['Alex CSM', 'Bella CSM', 'Charlie CSL', 'Diana Manager', 'Eddie Admin'];

const FEEDBACK_REASONS = [
  'Video quality needs improvement',
  'Audio is unclear',
  'Brand logo not visible enough',
  'Wrong product shown',
  'Caption does not match brief',
  'Background too cluttered',
  'Lighting too dark',
  'Need to reshoot opening scene',
  'Missing call-to-action',
  'Wrong hashtags used',
];

const PACKAGE_NAMES = ['Trial', 'Basic', 'Pro', 'Essential', 'Ultra', 'Custom'];

const CREATOR_AVATARS = (name: string, i: number) =>
  `https://api.dicebear.com/9.x/avataaars/svg?seed=creator_${i}&backgroundColor=b6e3f4,c0aede,d1d4f9`;

const CLIENT_AVATARS = (name: string, i: number) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=1340FF,1ABF66,8A5AFE&fontFamily=Arial`;

const BRAND_LOGOS = (brandName: string, i: number) =>
  `https://api.dicebear.com/9.x/shapes/svg?seed=brand_${i}&backgroundColor=transparent`;

const CAMPAIGN_IMAGES = (campaignIndex: number) => `https://picsum.photos/seed/campaign_${campaignIndex}/800/450`;

const ADMIN_AVATARS = (i: number) =>
  `https://api.dicebear.com/9.x/avataaars/svg?seed=admin_${i}&backgroundColor=ffdfbf,ffd5dc,c0aede`;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Date range: Feb 2025 → Feb 2026
const SEED_START = new Date('2025-02-01T00:00:00Z');
const SEED_END = new Date('2026-02-28T23:59:59Z');

// ─── CLEANUP ─────────────────────────────────────────────────────────────────

async function cleanUpPreviousRuns() {
  console.log('🧹 Cleaning up previous analytics seed data...');

  const targetUserFilter = {
    OR: [
      { email: { startsWith: 'client_analytics' } },
      { email: { startsWith: 'creator_analytics' } },
      { email: { startsWith: 'admin_analytics' } },
    ],
  };

  // 1. Find companies linked to these client users
  const clientsToDelete = await prisma.client.findMany({
    where: { user: targetUserFilter },
    select: { companyId: true },
  });
  const companyIds = clientsToDelete.map((c) => c.companyId).filter((id): id is string => id !== null);

  // 2. Delete leaf nodes
  await prisma.feedback.deleteMany({ where: { admin: targetUserFilter } });
  await prisma.pitch.deleteMany({ where: { user: targetUserFilter } });
  await prisma.submission.deleteMany({ where: { user: targetUserFilter } });
  await prisma.userFlow.deleteMany({ where: { user: targetUserFilter } });
  await prisma.npsFeedback.deleteMany({ where: { user: targetUserFilter } });

  // 3. Delete campaign data for those companies
  if (companyIds.length > 0) {
    const campaigns = await prisma.campaign.findMany({
      where: { companyId: { in: companyIds } },
    });
    const campaignIds = campaigns.map((c) => c.id);

    if (campaignIds.length > 0) {
      await prisma.feedback.deleteMany({
        where: { submission: { campaignId: { in: campaignIds } } },
      });
      await prisma.pitch.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.submission.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.shortListedCreator.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.creatorAgreement.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.campaignAdmin.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.campaignClient.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    }

    await prisma.subscriptionHistory.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.subscription.deleteMany({ where: { companyId: { in: companyIds } } });
  }

  // 4. Delete admin permission modules for admin_analytics users
  const adminUsers = await prisma.user.findMany({
    where: { email: { startsWith: 'admin_analytics' } },
    select: { id: true },
  });
  const adminUserIds = adminUsers.map((u) => u.id);
  if (adminUserIds.length > 0) {
    await prisma.adminPermissionModule.deleteMany({
      where: { admin: { userId: { in: adminUserIds } } },
    });
    await prisma.campaignAdmin.deleteMany({
      where: { adminId: { in: adminUserIds } },
    });
    await prisma.admin.deleteMany({ where: { userId: { in: adminUserIds } } });
  }

  // 5. Delete creator records
  const creatorUsers = await prisma.user.findMany({
    where: { email: { startsWith: 'creator_analytics' } },
    select: { id: true },
  });
  const creatorUserIds = creatorUsers.map((u) => u.id);
  if (creatorUserIds.length > 0) {
    await prisma.interest.deleteMany({ where: { userId: { in: creatorUserIds } } });
    await prisma.creator.deleteMany({ where: { userId: { in: creatorUserIds } } });
  }

  // 6. Delete clients
  await prisma.client.deleteMany({ where: { user: targetUserFilter } });

  // 7. Delete companies
  if (companyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }

  // 8. Delete users
  await prisma.user.deleteMany({ where: targetUserFilter });

  console.log('✨ Cleanup complete.');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting comprehensive analytics seed...');
  await cleanUpPreviousRuns();

  // ── Setup packages ──────────────────────────────────────────────────────
  const pkgBasic = await prisma.package.upsert({
    where: { id: 'pkg-basic' },
    update: {},
    create: { id: 'pkg-basic', name: 'Basic', credits: 10, validityPeriod: 30 },
  });

  const pkgPro = await prisma.package.upsert({
    where: { id: 'pkg-pro' },
    update: {},
    create: { id: 'pkg-pro', name: 'Pro', credits: 50, validityPeriod: 90 },
  });

  const pkgEssential = await prisma.package.upsert({
    where: { id: 'pkg-essential' },
    update: {},
    create: { id: 'pkg-essential', name: 'Essential', credits: 25, validityPeriod: 60 },
  });

  const packages = [pkgBasic, pkgPro, pkgEssential];

  // ── Setup submission types ──────────────────────────────────────────────
  const subTypeVideo = await prisma.submissionType.upsert({
    where: { type: 'VIDEO' },
    update: {},
    create: { type: 'VIDEO', description: 'Main Video Content' },
  });

  const subTypeFirstDraft = await prisma.submissionType.upsert({
    where: { type: 'FIRST_DRAFT' },
    update: {},
    create: { type: 'FIRST_DRAFT', description: 'First Draft Submission' },
  });

  const subTypeAgreement = await prisma.submissionType.upsert({
    where: { type: 'AGREEMENT_FORM' },
    update: {},
    create: { type: 'AGREEMENT_FORM', description: 'Agreement Form' },
  });

  // ── Setup CSM/CSL roles ─────────────────────────────────────────────────
  let csmRole = await prisma.role.findFirst({ where: { name: 'CSM' } });
  if (!csmRole) {
    csmRole = await prisma.role.create({ data: { name: 'CSM' } });
  }

  let cslRole = await prisma.role.findFirst({ where: { name: 'CSL' } });
  if (!cslRole) {
    cslRole = await prisma.role.create({ data: { name: 'CSL' } });
  }

  // ── Create Admin Users ──────────────────────────────────────────────────
  console.log('🛡️  Creating 5 admin users...');
  const adminRecords: { userId: string; adminId: string }[] = [];

  for (let i = 0; i < ADMIN_NAMES.length; i++) {
    const role = i < 3 ? csmRole : cslRole;
    const createdAt = randomDate(SEED_START, addDays(SEED_START, 30));

    const user = await prisma.user.create({
      data: {
        email: `admin_analytics_${i}@test.com`,
        name: ADMIN_NAMES[i],
        role: RoleEnum.admin,
        status: Status.active,
        createdAt,
        activatedAt: addHours(createdAt, randomInt(1, 12)),
        photoURL: ADMIN_AVATARS(i),
      },
    });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        roleId: role.id,
        mode: 'normal',
      },
    });

    adminRecords.push({ userId: user.id, adminId: admin.id });
  }

  // ── Create Creator Users ────────────────────────────────────────────────
  console.log('🎨 Creating 50 creator users...');

  interface CreatorRecord {
    userId: string;
    createdAt: Date;
    isActivated: boolean;
    formCompletedAt: Date | null;
  }

  const creatorRecords: CreatorRecord[] = [];

  for (let i = 0; i < 50; i++) {
    const createdAt = randomDate(SEED_START, SEED_END);
    // 85% activated
    const isActivated = Math.random() > 0.15;
    const activationDelayHours = isActivated
      ? Math.random() > 0.8
        ? randomInt(72, 336) // slow activators (3-14 days)
        : randomInt(1, 48) // fast activators
      : 0;

    const activatedAt = isActivated ? addHours(createdAt, activationDelayHours) : null;

    const formCompletedDelayHours = isActivated
      ? randomInt(1, activationDelayHours > 0 ? activationDelayHours : 24)
      : null;
    const formCompletedAt =
      isActivated && formCompletedDelayHours ? addHours(createdAt, formCompletedDelayHours) : null;

    const pronoun = pickRandom(PRONOUNS);
    const birthYear = randomInt(1985, 2006);
    const birthMonth = randomInt(1, 12);
    const birthDay = randomInt(1, 28);

    const user = await prisma.user.create({
      data: {
        email: `creator_analytics_${i}@test.com`,
        name: CREATOR_NAMES[i] || `Creator_${i}`,
        role: RoleEnum.creator,
        status: isActivated ? Status.active : Status.pending,
        createdAt,
        activatedAt,
        photoURL: CREATOR_AVATARS(CREATOR_NAMES[i] || `Creator_${i}`, i),
      },
    });

    await prisma.creator.create({
      data: {
        userId: user.id,
        pronounce: pronoun,
        birthDate: new Date(`${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`),
        isFormCompleted: isActivated,
        formCompletedAt,
        country: pickRandom(['Malaysia', 'Singapore', 'Indonesia', 'Thailand']),
        city: pickRandom(['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Singapore', 'Jakarta']),
      },
    });

    // Creator NPS (40% chance)
    if (isActivated && Math.random() > 0.6) {
      await prisma.npsFeedback.create({
        data: {
          userId: user.id,
          rating: randomInt(1, 5),
          userType: NpsUserType.CREATOR,
          createdAt: randomDate(createdAt, SEED_END),
        },
      });
    }

    // Creator onboarding flow
    if (isActivated) {
      const dropStep = Math.random() > 0.85 ? randomInt(0, CREATOR_STEPS.length - 1) : CREATOR_STEPS.length;

      for (let s = 0; s < Math.min(dropStep + 1, CREATOR_STEPS.length); s++) {
        await prisma.userFlow.create({
          data: {
            userId: user.id,
            flow: FlowType.CREATOR_ONBOARDING,
            step: CREATOR_STEPS[s],
            status: s < dropStep ? StepStatus.COMPLETED : StepStatus.ABANDONED,
            timeSpentSeconds: randomInt(15, 600),
            createdAt,
          },
        });
      }
    }

    creatorRecords.push({
      userId: user.id,
      createdAt,
      isActivated,
      formCompletedAt,
    });
  }

  const activeCreators = creatorRecords.filter((c) => c.isActivated);

  // ── Create Client Users & Companies ─────────────────────────────────────
  console.log('🏢 Creating 20 brands/clients...');

  interface ClientRecord {
    userId: string;
    companyId: string;
    subscriptionId: string | null;
    createdAt: Date;
    isActivated: boolean;
    packageId: string;
  }

  const clientRecords: ClientRecord[] = [];

  for (let i = 0; i < 20; i++) {
    const createdAt = randomDate(SEED_START, addDays(SEED_END, -60));
    // 90% activated
    const isActivated = Math.random() > 0.1;
    const activationDelayHours = isActivated ? (Math.random() > 0.8 ? randomInt(100, 300) : randomInt(1, 23)) : 0;
    const activatedAt = isActivated ? addHours(createdAt, activationDelayHours) : null;

    const user = await prisma.user.create({
      data: {
        email: `client_analytics_${i}@test.com`,
        name: BRAND_NAMES[i],
        role: RoleEnum.client,
        status: isActivated ? Status.active : Status.pending,
        createdAt,
        activatedAt,
        photoURL: CLIENT_AVATARS(BRAND_NAMES[i], i),
      },
    });

    const company = await prisma.company.create({
      data: {
        name: `${BRAND_NAMES[i]} Sdn Bhd`,
        logo: BRAND_LOGOS(BRAND_NAMES[i], i),
        clients: { create: { userId: user.id } },
      },
    });

    const chosenPkg = pickRandom(packages);
    let subscriptionId: string | null = null;

    if (isActivated) {
      // Create subscription
      const sub = await prisma.subscription.create({
        data: {
          companyId: company.id,
          packageId: chosenPkg.id,
          creditsUsed: randomInt(0, chosenPkg.credits),
          totalCredits: chosenPkg.credits,
          status: 'ACTIVE',
          expiredAt: addDays(createdAt, chosenPkg.validityPeriod),
        },
      });
      subscriptionId = sub.id;

      // Subscription history — multiple events over time
      const historyCount = randomInt(1, 4);
      for (let h = 0; h < historyCount; h++) {
        const changeTypes: SubscriptionChangeType[] = ['NEW_PACKAGE', 'RENEWAL', 'UPGRADE', 'DOWNGRADE'];
        const changeType = h === 0 ? 'NEW_PACKAGE' : pickRandom(changeTypes.slice(1));

        await prisma.subscriptionHistory.create({
          data: {
            companyId: company.id,
            subscriptionId: sub.id,
            changeType,
            newPackageId: pickRandom(packages).id,
            amountPaid: randomFloat(100, 2000),
            currency: pickRandom(['MYR', 'SGD']),
            createdAt: addDays(createdAt, h * randomInt(20, 60)),
          },
        });
      }

      // Client NPS (50% chance)
      if (Math.random() > 0.5) {
        await prisma.npsFeedback.create({
          data: {
            userId: user.id,
            rating: randomInt(1, 5),
            userType: NpsUserType.CLIENT,
            createdAt: randomDate(createdAt, SEED_END),
          },
        });
      }
    }

    // User flow funnel (campaign creation)
    const dropOffStep = Math.random() > 0.7 ? randomInt(0, STEPS.length - 1) : STEPS.length;

    for (let s = 0; s < Math.min(dropOffStep + 1, STEPS.length); s++) {
      const isCompleted = s < dropOffStep;

      let meta = {};
      if (['TARGET_AUDIENCE', 'ADDITIONAL_DETAILS_1', 'GENERAL_CAMPAIGN_INFORMATION'].includes(STEPS[s])) {
        const skips = pickRandomN(SKIPPABLE_FIELDS, randomInt(0, 3));
        if (skips.length > 0) meta = { skippedFields: skips };
      }

      await prisma.userFlow.create({
        data: {
          userId: user.id,
          flow: FlowType.CAMPAIGN_CREATION,
          step: STEPS[s],
          status: isCompleted ? StepStatus.COMPLETED : StepStatus.ABANDONED,
          timeSpentSeconds: randomInt(20, 600),
          meta: Object.keys(meta).length > 0 ? meta : undefined,
          createdAt,
        },
      });
    }

    // Bug reports (20% chance)
    if (isActivated && Math.random() > 0.8) {
      await prisma.bugs.create({
        data: {
          stepsToReproduce: `Step 1: ...\nStep 2: ...\nBug appears on ${pickRandom(['dashboard', 'campaign creation', 'submission review'])}`,
          userId: user.id,
          createdAt: randomDate(createdAt, SEED_END),
        },
      });
    }

    clientRecords.push({
      userId: user.id,
      companyId: company.id,
      subscriptionId,
      createdAt,
      isActivated,
      packageId: chosenPkg.id,
    });
  }

  const activeClients = clientRecords.filter((c) => c.isActivated);

  // ── Create 100 Campaigns ────────────────────────────────────────────────
  console.log('📢 Creating 100 campaigns...');

  // Distribute ~100 campaigns across active clients
  const campaignsPerClient: number[] = new Array(activeClients.length).fill(0);
  let remaining = 100;

  // Give each active client at least 1 campaign
  for (let i = 0; i < activeClients.length && remaining > 0; i++) {
    campaignsPerClient[i] = 1;
    remaining--;
  }

  // Distribute remaining randomly
  while (remaining > 0) {
    const idx = randomInt(0, activeClients.length - 1);
    campaignsPerClient[idx]++;
    remaining--;
  }

  let campaignIndex = 0;

  for (let ci = 0; ci < activeClients.length; ci++) {
    const client = activeClients[ci];
    const numCampaigns = campaignsPerClient[ci];

    for (let cc = 0; cc < numCampaigns; cc++) {
      const campaignCreatedAt = randomDate(
        new Date(Math.max(client.createdAt.getTime(), SEED_START.getTime())),
        SEED_END,
      );

      // 85% v4, 15% v2
      const version = Math.random() > 0.15 ? 'v4' : 'v2';

      // Random status weighted toward ACTIVE/COMPLETED
      const statusRoll = Math.random();
      let campaignStatus: CampaignStatus;
      if (statusRoll < 0.35) campaignStatus = CampaignStatus.ACTIVE;
      else if (statusRoll < 0.65) campaignStatus = CampaignStatus.COMPLETED;
      else if (statusRoll < 0.8) campaignStatus = CampaignStatus.PAUSED;
      else if (statusRoll < 0.9) campaignStatus = CampaignStatus.DRAFT;
      else campaignStatus = CampaignStatus.SCHEDULED;

      const campCredits = randomInt(5, 30);

      const campaign = await prisma.campaign.create({
        data: {
          name: `${pickRandom(CAMPAIGN_PREFIXES)} - ${BRAND_NAMES[ci % BRAND_NAMES.length]} #${cc + 1}`,
          description: `Analytics seed campaign ${campaignIndex} (${version})`,
          status: campaignStatus,
          companyId: client.companyId,
          origin: CampaignOrigin.CLIENT,
          submissionVersion: version,
          campaignCredits: campCredits,
          creditsPending: Math.random() > 0.5 ? 0 : randomInt(1, campCredits),
          creditsUtilized: randomInt(0, campCredits),
          subscriptionId: client.subscriptionId,
          createdAt: campaignCreatedAt,
          publishedAt:
            campaignStatus !== CampaignStatus.DRAFT ? addHours(campaignCreatedAt, randomInt(1, 48)) : undefined,
          completedAt:
            campaignStatus === CampaignStatus.COMPLETED ? addDays(campaignCreatedAt, randomInt(14, 90)) : undefined,
        },
      });

      const campaignEndDate = addDays(campaignCreatedAt, randomInt(30, 90));
      await prisma.campaignBrief.create({
        data: {
          campaignId: campaign.id,
          title: campaign.name,
          startDate: addDays(campaignCreatedAt, randomInt(1, 7)),
          endDate: campaignEndDate,
          images: [CAMPAIGN_IMAGES(campaignIndex), CAMPAIGN_IMAGES(campaignIndex + 1000)],
        },
      });

      // Assign 1-3 admins to this campaign
      const assignedAdmins = pickRandomN(adminRecords, randomInt(1, 3));
      for (const admin of assignedAdmins) {
        await prisma.campaignAdmin.create({
          data: {
            adminId: admin.userId,
            campaignId: campaign.id,
            role: 'manager',
          },
        });
      }

      // ── Creators per campaign ─────────────────────────────────────────
      const creatorsForCampaign = pickRandomN(activeCreators, randomInt(2, 8));

      for (let pi = 0; pi < creatorsForCampaign.length; pi++) {
        const creator = creatorsForCampaign[pi];

        // ── PITCH PHASE ───────────────────────────────────────────────
        const pitchCreatedAt = addHours(campaignCreatedAt, randomInt(1, 72));
        const turnaroundHours = Math.random() > 0.8 ? randomInt(48, 120) : randomInt(1, 24);

        const pitchStatusRoll = Math.random();
        let pitchStatus: PitchStatus;
        let rejectReason: string | null = null;
        let customText: string | null = null;
        let rejectedByClientId: string | null = null;
        let approvedByClientId: string | null = null;

        if (pitchStatusRoll < 0.55) {
          pitchStatus = PitchStatus.APPROVED;
          approvedByClientId = client.userId;
        } else if (pitchStatusRoll < 0.85) {
          pitchStatus = PitchStatus.REJECTED;
          rejectedByClientId = client.userId;
          rejectReason = pickRandom(REJECTION_REASONS);
          if (rejectReason === 'Others') customText = 'Specific rejection note from client';
        } else {
          pitchStatus = PitchStatus.SENT_TO_CLIENT;
        }

        await prisma.pitch.create({
          data: {
            campaignId: campaign.id,
            userId: creator.userId,
            type: 'pitch',
            status: pitchStatus,
            rejectionReason: rejectReason,
            customRejectionText: customText,
            rejectedByClientId,
            approvedByClientId,
            createdAt: pitchCreatedAt,
            completedAt:
              pitchStatus === PitchStatus.APPROVED || pitchStatus === PitchStatus.REJECTED
                ? addHours(pitchCreatedAt, turnaroundHours)
                : undefined,
          },
        });

        // ── SHORTLIST & AGREEMENT (approved creators only) ────────────
        if (pitchStatus === PitchStatus.APPROVED) {
          const shortlistDate = addHours(pitchCreatedAt, turnaroundHours + randomInt(1, 24));

          await prisma.shortListedCreator.create({
            data: {
              campaignId: campaign.id,
              userId: creator.userId,
              ugcVideos: randomInt(1, 3),
              amount: randomInt(200, 2000),
              currency: 'MYR',
              shortlisted_date: shortlistDate,
              isAgreementReady: true,
            },
          });

          const agreementCompletedAt = addHours(shortlistDate, randomInt(2, 72));

          await prisma.creatorAgreement.create({
            data: {
              campaignId: campaign.id,
              userId: creator.userId,
              agreementUrl: `https://storage.example.com/agreements/${campaign.id}/${creator.userId}.pdf`,
              isSent: true,
              amount: String(randomInt(200, 2000)),
              currency: 'MYR',
              completedAt: agreementCompletedAt,
            },
          });

          // ── Agreement submission ────────────────────────────────────
          const agreementSubmissionDate = addHours(agreementCompletedAt, randomInt(1, 48));

          await prisma.submission.create({
            data: {
              campaignId: campaign.id,
              userId: creator.userId,
              submissionTypeId: subTypeAgreement.id,
              status: SubmissionStatus.APPROVED,
              submissionDate: agreementSubmissionDate,
              createdAt: agreementCompletedAt,
              completedAt: agreementSubmissionDate,
              submissionVersion: version,
            },
          });

          // ── SUBMISSION PHASE (video/first draft) ────────────────────
          if (version === 'v4') {
            const videoSubmittedAt = addHours(agreementCompletedAt, randomInt(24, 240));

            const subStatusRoll = Math.random();
            let subStatus: SubmissionStatus;
            if (subStatusRoll < 0.4) subStatus = SubmissionStatus.CLIENT_APPROVED;
            else if (subStatusRoll < 0.7) subStatus = SubmissionStatus.APPROVED;
            else if (subStatusRoll < 0.85) subStatus = SubmissionStatus.CHANGES_REQUIRED;
            else subStatus = SubmissionStatus.IN_PROGRESS;

            const reviewTimeHours =
              subStatus === SubmissionStatus.CLIENT_APPROVED || subStatus === SubmissionStatus.APPROVED
                ? Math.random() > 0.9
                  ? randomInt(100, 200)
                  : randomInt(2, 72)
                : undefined;

            const submission = await prisma.submission.create({
              data: {
                campaignId: campaign.id,
                userId: creator.userId,
                submissionTypeId: subTypeVideo.id,
                status: subStatus,
                submissionDate: videoSubmittedAt,
                createdAt: videoSubmittedAt,
                completedAt: reviewTimeHours ? addHours(videoSubmittedAt, reviewTimeHours) : undefined,
                submissionVersion: 'v4',
                contentOrder: 1,
              },
            });

            // Feedback rounds
            const feedbackRounds = Math.random() > 0.6 ? randomInt(1, 5) : 0;

            for (let r = 0; r < feedbackRounds; r++) {
              const feedbackAdmin = pickRandom(assignedAdmins);
              await prisma.feedback.create({
                data: {
                  submissionId: submission.id,
                  adminId: feedbackAdmin.userId,
                  content: `Round ${r + 1}: ${pickRandom(FEEDBACK_REASONS)}`,
                  type: 'REQUEST',
                  reasons: pickRandomN(FEEDBACK_REASONS, randomInt(1, 3)),
                  sentToCreator: true,
                  createdAt: addHours(videoSubmittedAt, (r + 1) * randomInt(6, 48)),
                },
              });
            }
          } else {
            // v2 flow — first draft
            const draftSubmittedAt = addHours(agreementCompletedAt, randomInt(24, 168));

            const submission = await prisma.submission.create({
              data: {
                campaignId: campaign.id,
                userId: creator.userId,
                submissionTypeId: subTypeFirstDraft.id,
                status: SubmissionStatus.APPROVED,
                submissionDate: draftSubmittedAt,
                createdAt: draftSubmittedAt,
                completedAt: addHours(draftSubmittedAt, randomInt(2, 96)),
                submissionVersion: 'v2',
              },
            });

            // Some feedback
            if (Math.random() > 0.5) {
              const feedbackAdmin = pickRandom(assignedAdmins);
              await prisma.feedback.create({
                data: {
                  submissionId: submission.id,
                  adminId: feedbackAdmin.userId,
                  content: pickRandom(FEEDBACK_REASONS),
                  type: 'REASON',
                  reasons: pickRandomN(FEEDBACK_REASONS, randomInt(1, 2)),
                  sentToCreator: false,
                  createdAt: addHours(draftSubmittedAt, randomInt(6, 48)),
                },
              });
            }
          }
        }
      }

      campaignIndex++;
      if (campaignIndex % 20 === 0) {
        console.log(`  📊 Created ${campaignIndex} / 100 campaigns...`);
      }
    }
  }

  // ── Creator invoices (for earnings analytics) ───────────────────────────
  console.log('💰 Creating creator invoices...');

  const shortlistedCreators = await prisma.shortListedCreator.findMany({
    where: {
      campaign: {
        company: {
          clients: {
            some: { user: { email: { startsWith: 'client_analytics' } } },
          },
        },
      },
      userId: { not: null },
    },
    select: { userId: true, campaignId: true, amount: true },
  });

  let invoiceCounter = 0;
  for (const sc of shortlistedCreators) {
    if (!sc.userId || Math.random() > 0.7) continue; // 70% get invoices

    const statusRoll = Math.random();
    const invoiceStatus = statusRoll < 0.6 ? 'paid' : statusRoll < 0.8 ? 'pending' : 'draft';

    try {
      await prisma.invoice.create({
        data: {
          invoiceNumber: `INV-SEED-${Date.now()}-${invoiceCounter++}`,
          amount: sc.amount || randomFloat(200, 2000),
          status: invoiceStatus as any,
          campaignId: sc.campaignId,
          creatorId: sc.userId,
          dueDate: addDays(new Date(), randomInt(-30, 30)),
          createdAt: randomDate(SEED_START, SEED_END),
        },
      });
    } catch {
      // skip duplicate constraint errors
    }
  }

  console.log(`  💵 Created ${invoiceCounter} invoices.`);
  console.log('✅ Seed complete. Database populated with visualization-ready data for all 3 dashboards.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
