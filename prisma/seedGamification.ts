import { Prisma, PrismaClient, Rank, RewardType } from '@prisma/client';
import { RANKS } from '../src/constants/gamification';

const prisma = new PrismaClient();

export const GAMIFICATION_XP: { name: string; point: number | null; code: string; rewardType: RewardType }[] = [
  {
    name: 'Hunt Location Claim',
    code: 'hunt_location_claim',
    point: null,
    rewardType: 'repeatable',
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
    rewardType: 'repeatable',
  },
  {
    name: 'LeaderBoard Top 3',
    code: 'leaderboard_top_3',
    point: 500,
    rewardType: 'repeatable',
  },
  {
    name: 'Connecting Media Kit',
    code: 'connecting_media_kit',
    point: 100,
    rewardType: 'one_time',
  },
  {
    name: 'Weekly Tasks',
    code: 'weekly_tasks',
    point: null,
    rewardType: 'repeatable',
  },
  {
    name: 'Achievement',
    code: 'achievement',
    point: null,
    rewardType: 'repeatable',
  },
];

export const ACHIEVEMENTS: {
  code: string;
  name: string;
  category: string;
  rarity: string;
  icon: string;
  description: string;
  xp: number;
  target: number;
  sortOrder: number;
}[] = [
  {
    code: 'first-light',
    name: 'First Light',
    category: 'beginner',
    rarity: 'common',
    icon: 'lightbulb-outline',
    description: 'Register and log in for the first time on Cult Creative.',
    xp: 25,
    target: 1,
    sortOrder: 0,
  },
  {
    code: 'overachiever',
    name: 'Overachiever',
    category: 'beginner',
    rarity: 'common',
    icon: 'trophy-outline',
    description: 'Get shortlisted for a campaign 3 times.',
    xp: 25,
    target: 3,
    sortOrder: 1,
  },
  {
    code: 'pitch-perfect',
    name: 'Pitch Perfect',
    category: 'beginner',
    rarity: 'common',
    icon: 'bullhorn-outline',
    description: 'Pitch for 5 campaigns.',
    xp: 25,
    target: 5,
    sortOrder: 2,
  },
  {
    code: 'in-demand',
    name: 'In Demand',
    category: 'beginner',
    rarity: 'common',
    icon: 'bookmark-outline',
    description: 'Get 3 of your pitch approved.',
    xp: 200,
    target: 3,
    sortOrder: 3,
  },
  {
    code: 'media-kitter',
    name: 'Media Kitter',
    category: 'beginner',
    rarity: 'uncommon',
    icon: 'card-account-details-outline',
    description: 'Connect your Instagram AND TikTok to the Media Kit.',
    xp: 200,
    target: 2,
    sortOrder: 4,
  },
  {
    code: 'first-drop',
    name: 'First Drop',
    category: 'beginner',
    rarity: 'rare',
    icon: 'file-upload-outline',
    description: 'Submit your first campaign submission.',
    xp: 200,
    target: 1,
    sortOrder: 5,
  },
  {
    code: 'star-creator',
    name: 'Star Creator',
    category: 'intermediate',
    rarity: 'common',
    icon: 'star-outline',
    description: 'Get Top 10 on the creator leaderboard for 3 months',
    xp: 200,
    target: 3,
    sortOrder: 6,
  },
  {
    code: 'encore',
    name: 'Encore',
    category: 'intermediate',
    rarity: 'uncommon',
    icon: 'repeat',
    description: 'Participate in a 2nd campaign with the same brand.',
    xp: 200,
    target: 1,
    sortOrder: 7,
  },
  {
    code: 'crowd-pleaser',
    name: 'Crowd Pleaser',
    category: 'intermediate',
    rarity: 'uncommon',
    icon: 'account-group-outline',
    description: 'Have a campaign submission surpass 50K views',
    xp: 200,
    target: 50000,
    sortOrder: 8,
  },
  {
    code: 'quick-turn',
    name: 'Quick Turn',
    category: 'intermediate',
    rarity: 'rare',
    icon: 'speedometer',
    description: 'Submit a campaign submission within 72 hours of being shortlisted',
    xp: 200,
    target: 1,
    sortOrder: 9,
  },
  {
    code: 'showrunner',
    name: 'Showrunner',
    category: 'intermediate',
    rarity: 'rare',
    icon: 'stadium-outline',
    description: 'Participate in 3 campaigns at the same time',
    xp: 200,
    target: 3,
    sortOrder: 10,
  },
  {
    code: 'side-hustle',
    name: 'Side Hustle',
    category: 'intermediate',
    rarity: 'legendary',
    icon: 'credit-card-outline',
    description: 'Earn RM1000 through the Cult Creative App',
    xp: 200,
    target: 1000,
    sortOrder: 11,
  },
  {
    code: 'hall-of-famer',
    name: 'Hall of Famer',
    category: 'advanced',
    rarity: 'rare',
    icon: 'diamond-outline',
    description: 'Hit the leaderboard Top 3 at least once',
    xp: 200,
    target: 1,
    sortOrder: 12,
  },
  {
    code: 'brand-expert',
    name: 'Brand Expert',
    category: 'advanced',
    rarity: 'legendary',
    icon: 'shield-star-outline',
    description: 'Get a five star rating from 5 separate Clients, 5 times',
    xp: 200,
    target: 5,
    sortOrder: 13,
  },
  {
    code: 'cult-legend',
    name: 'Cult Legend',
    category: 'advanced',
    rarity: 'legendary',
    icon: 'crown-outline',
    description: 'Complete 25 campaigns in total',
    xp: 1000,
    target: 25,
    sortOrder: 14,
  },
  {
    code: 'night-owl',
    name: 'Night Owl',
    category: 'secret',
    rarity: 'secret',
    icon: 'weather-night',
    description: 'Submit a campaign submission between midnight and 5AM.',
    xp: 300,
    target: 1,
    sortOrder: 15,
  },
  {
    code: 'first-mover',
    name: 'First Mover',
    category: 'secret',
    rarity: 'secret',
    icon: 'rocket-launch-outline',
    description: 'Pitch within 1 hour of a campaign going live.',
    xp: 300,
    target: 1,
    sortOrder: 16,
  },
  {
    code: 'lurker',
    name: 'Lurker',
    category: 'secret',
    rarity: 'secret',
    icon: 'incognito',
    description: 'Visit the Cult Codex 10 times.',
    xp: 300,
    target: 10,
    sortOrder: 17,
  },
  {
    code: 'codex-hunter',
    name: 'Codex Hunter',
    category: 'secret',
    rarity: 'secret',
    icon: 'book-search-outline',
    description: 'Unlock every other badge in the Cult Codex.',
    xp: 300,
    target: 17,
    sortOrder: 18,
  },
];

const seedGamification = async () => {
  // 1. Ranks
  for (const rank of RANKS) {
    await prisma.rank.upsert({
      where: { name: rank.name },
      update: { minPoints: rank.minXp },
      create: { name: rank.name, minPoints: rank.minXp },
    });
  }

  // 2. Point actions
  for (const item of GAMIFICATION_XP) {
    await prisma.xpAction.upsert({
      where: { code: item.code },
      update: { name: item.name, points: item.point, rewardType: item.rewardType },
      create: { code: item.code, name: item.name, points: item.point, rewardType: item.rewardType },
    });
  }

  for (const badge of ACHIEVEMENTS) {
    const { code, ...rest } = badge;
    await prisma.achievement.upsert({
      where: { code },
      update: rest,
      create: { code, ...rest },
    });
  }

  console.log(
    `Done seeding gamification (${RANKS.length} ranks, ${GAMIFICATION_XP.length} actions, ${ACHIEVEMENTS.length} achievements).`,
  );
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
