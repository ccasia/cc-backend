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

const scopes = [
  { name: 'list:admin', description: 'View all admins' },
  { name: 'create:admin', description: 'Create new admin' },
  { name: 'update:admin', description: 'Edit existing admin' },
  { name: 'delete:admin', description: 'Remove admins' },
  
  { name: 'view:invoice', description: 'View invoice details' },
  { name: 'list:invoice', description: 'View all invoices' },
  { name: 'create:invoice', description: 'Create new invoices' },
  { name: 'update:invoice', description: 'Edit existing invoices' },
  { name: 'delete:invoice', description: 'Remove invoices' },

  { name: 'list:creator', description: 'View all creators' },
  { name: 'view:creator', description: 'View creator profiles' },
  { name: 'create:creator', description: 'Add new creators' },
  { name: 'update:creator', description: 'Edit creator details' },
  { name: 'delete:creator', description: 'Remove creators' },
  
  { name: 'list:client', description: 'View client details' },
  { name: 'view:client', description: 'View client profiles' },
  { name: 'create:client', description: 'Add new clients' },
  { name: 'update:client', description: 'Edit client details' },
  { name: 'delete:client', description: 'Remove clients' },

  { name: 'list:campaign', description: 'View all campaigns' },
  { name: 'view:campaign', description: 'View campaign details' },
  { name: 'create:campaign', description: 'Create new campaigns' },
  { name: 'update:campaign', description: 'Edit existing campaigns' },
  { name: 'delete:campaign', description: 'Remove campaigns' },

  { name: 'list:metrics', description: 'View all metrics' },
  { name: 'view:metrics', description: 'View metrics details' },
  { name: 'create:metrics', description: 'Create new metrics' },
  { name: 'update:metrics', description: 'Update existing metrics' },
  { name: 'delete:metrics', description: 'Remove metrics' },
  { name: 'list:agreements', description: 'View all agreements' },
];

const csmRoles = {
  permissions: ['view:campaign', 'create:campaign', 'update:campaign', 'delete:campaign', 'list:creator'],
};

const financeRole = {
  permissions: [
    'view:invoice',
    'list:invoice',
    'create:invoice',
    'update:invoice',
    'delete:invoice',
    'list:agreements',
  ],
};

const bdRole = {
  permissions: ['list:campaign', 'view:campaign', 'list:creator', 'view:creator'],
};

const growthRole = {
  permissions: ['list:campaign', 'view:campaign', 'list:brand', 'view:brand', 'list:metrics', 'view:metrics'],
};

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
  // await Promise.all([
  //   timeline_type.forEach(async (value) => {
  //     await prisma.timelineTypeDefault.create({
  //       data: {
  //         name: value
  //           .split(' ')
  //           .map((e) => `${e[0].toUpperCase()}${e.slice(1)}`)
  //           .join(' '),
  //       },
  //     });
  //   }),
  //   submissionType.forEach(async (value) => {
  //     await prisma.submissionType.create({
  //       data: {
  //         type: value as SubmissionEnum,
  //       },
  //     });
  //   }),
  // ]);
  // const permissions = await Promise.all(
  //   scopes.map(async (elem) => {
  //     return await prisma.permisions.create({
  //       data: {
  //         name: elem.name,
  //         descriptions: elem.description,
  //       },
  //     });
  //   }),
  // );
  // Uncomment code below to create list of roles and permissions
  // const permissions = await prisma.permisions.findMany(); //comment this line if permissions is not created yet
  // const permissions = await Promise.all(
  //   scopes.map(async (elem) => {
  //     return await prisma.permisions.create({
  //       data: {
  //         name: elem.name,
  //         descriptions: elem.description,
  //       },
  //     });
  //   }),
  // );
  // Create CSM Role
  // const csmPermissions = csmRoles.permissions;
  // const filteredCSMPermissions = permissions.filter((item) => csmPermissions.includes(item.name));
  // await prisma.role.create({
  //   data: {
  //     name: 'CSM',
  //     permissions: {
  //       connect: filteredCSMPermissions.map((item) => ({ id: item.id })),
  //     },
  //   },
  // });
  // Create Finance Role
  // const financePermissions = financeRole.permissions;
  // const filteredFinancePermissions = permissions.filter((item) => financePermissions.includes(item.name));
  // await prisma.role.create({
  //   data: {
  //     name: 'Finance',
  //     permissions: {
  //       connect: filteredFinancePermissions.map((item) => ({ id: item.id })),
  //     },
  //   },
  // });
  // const bdPermissions = bdRole.permissions;
  // const filteredbdPermissions = permissions.filter((item) => bdPermissions.includes(item.name));
  // await prisma.role.create({
  //   data: {
  //     name: 'BD',
  //     permissions: {
  //       connect: filteredbdPermissions.map((item) => ({ id: item.id })),
  //     },
  //   },
  // });
  // const growthPermissions = growthRole.permissions;
  // const filteredgrowthPermissions = permissions.filter((item) => growthPermissions.includes(item.name));
  // await prisma.role.create({
  //   data: {
  //     name: 'Growth',
  //     permissions: {
  //       connect: filteredgrowthPermissions.map((item) => ({ id: item.id })),
  //     },
  //   },
  // });
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
