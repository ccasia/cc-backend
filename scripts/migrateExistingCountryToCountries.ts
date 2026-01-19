import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const campaignRequirements = await prisma.campaignRequirement.findMany({
    select: {
      id: true,
      country: true,
      countries: true,
    },
  });

  for (const campaign of campaignRequirements) {
    if (campaign.countries.length) return;

    await prisma.campaignRequirement.update({
      where: {
        id: campaign.id,
      },
      data: {
        countries: campaign.country ? [campaign.country] : [],
      },
    });
  }
}

main()
  // eslint-disable-next-line promise/always-return
  .then(() => {
    console.log('✅ Done');
  })
  .catch((err) => {
    prisma.$disconnect();
  });
