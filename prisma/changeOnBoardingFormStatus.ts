import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  const users = await prisma.user.findMany({
    include: {
      creator: {
        include: {
          interests: true,
        },
      },
    },
  });

  for (const user of users) {
    if (
      user.phoneNumber &&
      user.country &&
      user.creator?.pronounce &&
      user.creator.location &&
      user.creator.birthDate &&
      user.creator.employment &&
      user.creator.languages &&
      user.creator.interests.length
    ) {
      await prisma.creator.update({
        where: {
          id: user.creator.id,
        },
        data: {
          isOnBoardingFormCompleted: true,
        },
      });
    } else if (user.creator) {
      await prisma.creator.update({
        where: {
          id: user.creator!.id,
        },
        data: {
          isOnBoardingFormCompleted: false,
        },
      });
    }
  }
};

// eslint-disable-next-line promise/catch-or-return
run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
