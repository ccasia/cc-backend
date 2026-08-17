import { PrismaClient } from '@prisma/client';

import { generateFeaturedVideoThumbnail } from '@services/videoOfTheMonthService';

const prisma = new PrismaClient();

const run = async () => {
  const records = await prisma.videoOfTheMonth.findMany({
    where: { thumbnailUrl: null },
    select: { id: true },
  });

  for (const record of records) {
    try {
      await generateFeaturedVideoThumbnail(record.id);
      console.log(`Generated thumbnail for ${record.id}`);
    } catch (error) {
      console.error(`Failed to generate thumbnail for ${record.id}`, error);
    }
  }
};

run()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
