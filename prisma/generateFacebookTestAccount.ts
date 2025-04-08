import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const credentials = {
  email: 'facebook@facebook.com',
  password: 'facebook123',
  name: 'Facebook Tester',
  country: 'Malaysia',
  phonerNumber: '0011',
  status: 'active',
  role: 'creator',
  creator: {
    pronouce: 'he/him',
    address: 'facebook',
    state: 'facebook',
    location: 'facebook',
    birthDate: dayjs().format(),
    employment: 'fulltime',
    languages: ['English'],
    isFormCompleted: true,
  },
};

const createTestUser = async () => {
  await prisma.user.create({
    data: {
      email: credentials.email,
      password: await bcrypt.hash(credentials.password, 10),
      name: credentials.name,
      phoneNumber: credentials.phonerNumber,
      status: 'active',
      role: 'creator',
      creator: {
        create: {
          pronounce: credentials.creator.pronouce,
          address: credentials.creator.address,
          state: credentials.creator.state,
          location: credentials.creator.location,
          birthDate: credentials.creator.birthDate as any,
          employment: credentials.creator.employment as any,
          languages: credentials.creator.languages,
          isFormCompleted: credentials.creator.isFormCompleted,
        },
      },
    },
  });
};

// eslint-disable-next-line promise/catch-or-return
createTestUser()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
