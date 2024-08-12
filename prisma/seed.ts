import { PrismaClient, SubmissionEnum } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const timeline_type = [
  'open for pitch',
  'filter pitch',
  'shortlist creator',
  'agreement',
  'first draft',
  'feedback first draft',
  'final draft',
  'feedback final draft',
  'qc',
  'posting',
];

const submissionType = ['FIRST_DRAFT', 'FINAL_DRAFT', 'AGREEMENT_FORM', 'POSTING', 'OTHER'];

async function main() {
  // Seed Users
  // const user1 = await prisma.user.create({
  //   data: {
  //     email: 'user1@example.com',
  //     password: await bcrypt.hash('password1', 10),
  //     name: 'User One',
  //     photoURL: 'https://example.com/user1.jpg',
  //     country: 'Malaysia',
  //     phoneNumber: '+60123456789',
  //     role: 'creator', // Replace with actual enum value if different
  //     status: 'pending', // Replace with actual enum value if different
  //     creator: {
  //       create: {
  //         pronounce: 'he/him',
  //         address: '123 Street, City, Malaysia',
  //         state: 'Selangor',
  //         location: 'Malaysia',
  //         birthDate: new Date('1990-01-01'),
  //         instagram: 'user1_insta',
  //         tiktok: 'user1_tiktok',
  //         employment: 'others', // Replace with actual enum value if different
  //         languages: JSON.stringify(['English', 'Malay']),
  //         industries: {
  //           create: [{ name: 'Tech' }, { name: 'Fashion' }], // Assuming Industry has a 'name' field
  //         },
  //         interests: {
  //           create: [{ name: 'Gaming' }, { name: 'Travel' }], // Assuming Interest has a 'name' field
  //         },
  //         mediaKit: {
  //           create: {
  //             photoUrl: 'https://example.com/mediakit1.jpg',
  //             name: 'Media Kit 1',
  //             about: 'About Media Kit 1',
  //             interests: ['Gaming', 'Travel'],
  //           },
  //         },
  //       },
  //     },
  //   },
  // });
  // const user2 = await prisma.user.create({
  //   data: {
  //     email: 'user2@example.com',
  //     password: await bcrypt.hash('password2', 10),
  //     name: 'User Two',
  //     photoURL: 'https://example.com/user2.jpg',
  //     country: 'Malaysia',
  //     phoneNumber: '+60198765432',
  //     role: 'creator', // Replace with actual enum value if different
  //     status: 'active', // Replace with actual enum value if different
  //     creator: {
  //       create: {
  //         pronounce: 'she/her',
  //         address: '456 Avenue, City, Malaysia',
  //         state: 'Kuala Lumpur',
  //         location: 'Malaysia',
  //         birthDate: new Date('1992-02-02'),
  //         instagram: 'user2_insta',
  //         tiktok: 'user2_tiktok',
  //         employment: 'fulltime', // Replace with actual enum value if different
  //         languages: JSON.stringify(['English', 'Chinese']),
  //         industries: {
  //           create: [{ name: 'Food' }, { name: 'Travel' }], // Assuming Industry has a 'name' field
  //         },
  //         interests: {
  //           create: [{ name: 'Photography' }, { name: 'Food' }], // Assuming Interest has a 'name' field
  //         },
  //         mediaKit: {
  //           create: {
  //             photoUrl: 'https://example.com/mediakit2.jpg',
  //             name: 'Media Kit 2',
  //             about: 'About Media Kit 2',
  //             interests: ['Photography', 'Food'],
  //           },
  //         },
  //       },
  //     },
  //   },
  // });
  // console.log({ user1, user2 });

  // Create Timeline Type
  await Promise.all([
    timeline_type.forEach(async (value) => {
      await prisma.timelineTypeDefault.create({
        data: {
          name: value
            .split(' ')
            .map((e) => `${e[0].toUpperCase()}${e.slice(1)}`)
            .join(' '),
        },
      });
    }),
    submissionType.forEach(async (value) => {
      await prisma.submissionType.create({
        data: {
          type: value as SubmissionEnum,
        },
      });
    }),
  ]);
}

// eslint-disable-next-line promise/catch-or-return
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
