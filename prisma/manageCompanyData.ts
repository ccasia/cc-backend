import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        brand: true,
      },
    });

    for (const company of companies) {
      if (company.brand.length > 0) {
        await prisma.company.update({ where: { id: company.id }, data: { type: 'agency' } });
      } else {
        await prisma.company.update({ where: { id: company.id }, data: { type: 'directClient' } });
      }
    }

    return 'Success';
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
