import { Prisma, PrismaClient, Rank, RewardType } from '@prisma/client';
import { RANKS } from '../src/constants/gamification';

const prisma = new PrismaClient();

export const GAMIFICATION_XP: { name: string; point: number | null; code: string; rewardType: RewardType }[] = [
  {
    name: 'Hunt Location Claim',
    code: 'hunt_location_claim',
    point: null,
    rewardType: 'one_time',
  },
  {
    name: 'Pitch Submitted',
    code: 'pitch_submitted',
    point: 10,
    rewardType: 'repeatable',
  },
  {
    name: 'Pitch Approved',
    code: 'pitch_approved',
    point: 50,
    rewardType: 'repeatable',
  },
  {
    name: 'Shortlisted',
    code: 'shortlisted',
    point: 50,
    rewardType: 'repeatable',
  },
  {
    name: 'Submission Submitted',
    code: 'submission_submitted',
    point: 75,
    rewardType: 'repeatable',
  },
  {
    name: 'Submission Approved',
    code: 'submission_approved',
    point: 150,
    rewardType: 'repeatable',
  },
  {
    name: 'Posting Link Submitted',
    code: 'posting_link_submitted',
    point: 25,
    rewardType: 'repeatable',
  },
  {
    name: 'Posting Link Approved',
    code: 'posting_link_approved',
    point: 100,
    rewardType: 'repeatable',
  },
  {
    name: 'Client Rating 4',
    code: 'client_rating_4',
    point: 100,
    rewardType: 'repeatable',
  },
  {
    name: 'Client Rating 5',
    code: 'client_rating_5',
    point: 150,
    rewardType: 'repeatable',
  },
  {
    name: 'LeaderBoard Top 10',
    code: 'leaderboard_top_10',
    point: 250,
    rewardType: 'one_time',
  },
  {
    name: 'LeaderBoard Top 3',
    code: 'leaderboard_top_3',
    point: 500,
    rewardType: 'one_time',
  },
  {
    name: 'Connecting Media Kit',
    code: 'connecting_media_kit',
    point: 100,
    rewardType: 'one_time',
  },
  {
    name: 'Weekly Tasks',
    code: 'connecting_media_kit',
    point: null,
    rewardType: 'one_time',
  },
];

const seedGamification = async () => {
  // 1.Create Ranks
  const createManyRanks: Prisma.RankCreateManyInput[] = RANKS.map((rank) => ({
    name: rank.name,
    minPoints: rank.minXp,
  }));

  await prisma.rank.createMany({
    data: createManyRanks,
  });

  // 2. Create Point Actions
  const createManyPoints: Prisma.XpActionCreateManyInput[] = GAMIFICATION_XP.map((item) => ({
    name: item.name,
    points: item.point,
    code: item.code,
    rewardType: item.rewardType,
  }));

  await prisma.xpAction.createMany({
    data: createManyPoints,
  });

  console.log('Done seeding gamification.');
};

seedGamification()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
