/**
 * Backfill Campaign.isNdaRequired from the campaign's linked AgreementTemplate.
 *
 * The NDA flag used to live on AgreementTemplate. It now lives on Campaign.
 * Run this once per database, after `npx prisma db push` has added the column.
 *
 *   npx ts-node src/scripts/backfillCampaignNda.ts
 *
 * Safe to run more than once: it only turns NDA on for campaigns whose template had NDA on.
 * It never turns NDA off and never touches other fields.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  const campaigns = await prisma.campaign.findMany({
    where: { isNdaRequired: false, agreementTemplate: { isNdaRequired: true } },
    select: { id: true, name: true },
  });

  if (campaigns.length === 0) {
    console.log('No campaigns to backfill.');
    return;
  }

  const { count } = await prisma.campaign.updateMany({
    where: { id: { in: campaigns.map((campaign) => campaign.id) }, isNdaRequired: false },
    data: { isNdaRequired: true },
  });

  campaigns.forEach((campaign) => console.log(`Turned NDA on for ${campaign.id} (${campaign.name})`));
  console.log(`Updated ${count} campaign(s).`);
};

run()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    if (String(error?.message).includes('isNdaRequired')) {
      console.error('Campaign.isNdaRequired is missing. Run `npx prisma db push` first.');
    }
    console.error(error);
    process.exitCode = 1;
  });
