import { PrismaClient, SubmissionEnum } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
    'view:campaign',
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
  // await Promise.all([
  //   timeline_type.forEach(async (value) => {
  //     await prisma.timelineTypeDefault.upsert({
  //       where: {
  //         name: value
  //           .split(' ')
  //           .map((e) => `${e[0].toUpperCase()}${e.slice(1)}`)
  //           .join(' '),
  //       },
  //       update: {
  //         name: value
  //           .split(' ')
  //           .map((e) => `${e[0].toUpperCase()}${e.slice(1)}`)
  //           .join(' '),
  //       },
  //       create: {
  //         name: value
  //           .split(' ')
  //           .map((e) => `${e[0].toUpperCase()}${e.slice(1)}`)
  //           .join(' '),
  //       },
  //     });
  //   }),
  //   submissionType.forEach(async (value) => {
  //     await prisma.submissionType.upsert({
  //       where: {
  //         type: value as SubmissionEnum,
  //       },
  //       update: {
  //         type: value as SubmissionEnum,
  //       },
  //       create: {
  //         type: value as SubmissionEnum,
  //       },
  //     });
  //   }),
  // ]);
  // // Uncomment code below to create list of roles and permissions
  // // const permissions = await prisma.permisions.findMany(); //comment this line if permissions is not created yet
  const permissions = await Promise.all(
    scopes.map(async (elem) => {
      return await prisma.permisions.create({
        data: {
          name: elem.name,
          descriptions: elem.description,
        },
      });
    }),
  );
  // Create CSM Role
  const csmPermissions = csmRoles.permissions;
  const filteredCSMPermissions = permissions.filter((item) => csmPermissions.includes(item.name));
  await prisma.role.create({
    data: {
      name: 'CSM',
      permissions: {
        connect: filteredCSMPermissions.map((item) => ({ id: item.id })),
      },
    },
  });
  // Create Finance Role
  const financePermissions = financeRole.permissions;
  const filteredFinancePermissions = permissions.filter((item) => financePermissions.includes(item.name));
  await prisma.role.create({
    data: {
      name: 'Finance',
      permissions: {
        connect: filteredFinancePermissions.map((item) => ({ id: item.id })),
      },
    },
  });
  const bdPermissions = bdRole.permissions;
  const filteredbdPermissions = permissions.filter((item) => bdPermissions.includes(item.name));
  await prisma.role.create({
    data: {
      name: 'BD',
      permissions: {
        connect: filteredbdPermissions.map((item) => ({ id: item.id })),
      },
    },
  });
  const growthPermissions = growthRole.permissions;
  const filteredgrowthPermissions = permissions.filter((item) => growthPermissions.includes(item.name));
  await prisma.role.create({
    data: {
      name: 'Growth',
      permissions: {
        connect: filteredgrowthPermissions.map((item) => ({ id: item.id })),
      },
    },
  });
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
