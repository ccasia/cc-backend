import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'asc' },
    });

    for (const [index, company] of Object.entries(companies)) {
      await prisma.company.update({
        where: {
          id: company.id,
        },
        data: {
          clientId: `A0${parseInt(index) + 1}`,
        },
      });
    }
  } catch (error) {
    throw new Error(error);
  }
};

// eslint-disable-next-line promise/catch-or-return
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
