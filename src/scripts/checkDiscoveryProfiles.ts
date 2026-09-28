import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from '../prisma/prisma';
import { buildDiscoverySelect, mapDiscoveryRows } from '../helper/discovery/savedProfiles';

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: ['JISOO', 'VALORANT', 'Telvinator', 'Joe Doe', 'Michael Lee'].map((name) => ({
        name: { contains: name, mode: 'insensitive' as const },
      })),
    },
    select: buildDiscoverySelect(true),
  });
  const rows = mapDiscoveryRows(users, 'all');
  for (const row of rows)
    console.log(
      JSON.stringify({
        name: row.name,
        platform: row.platform,
        isGuest: row.isGuest,
        rate: row[row.platform].engagementRate,
        followers: row[row.platform].followers,
        source: row[row.platform].metricSource,
        profileUrl: row[row.platform].profileUrl,
        posts: row[row.platform].scrapeDetails?.selectedPosts?.length ?? 0,
      }),
    );
  for (const [name, rate, platform] of [
    ['JISOO', 7.55, 'instagram'],
    ['VALORANT', 4.77, 'instagram'],
    ['Telvinator', 24.39, 'tiktok'],
    ['Joe Doe', 12, 'instagram'],
    ['Michael Lee', 0.21, 'instagram'],
  ] as const) {
    const row = rows.find((item) => item.name.toLowerCase().includes(name.toLowerCase()) && item.platform === platform);
    assert.ok(row, `${name} ${platform} exists`);
    assert.equal(row[platform].engagementRate, rate, `${name} rate`);
  }
  console.log('All five local rates match.');
}
main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
