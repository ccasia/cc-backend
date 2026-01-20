import { PrismaClient, SubmissionEnum, PackageType } from '@prisma/client';

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

const pakcagesArray: any[] = [
  {
    type: 'Trial',
    valueMYR: 7000,
    valueSGD: 7200,
    totalCredits: 10,
    validityPeriod: 1,
  },
  //basic deprecated
  {
    type: 'Basic',
    valueMYR: 8000,
    valueSGD: 8900,
    totalCredits: 15,
    validityPeriod: 2,
  },
  {
    type: 'Essential',
    valueMYR: 20100,
    valueSGD: 21500,
    totalCredits: 30,
    validityPeriod: 3,
  },
  {
    type: 'Pro',
    valueMYR: 32000,
    valueSGD: 34500,
    totalCredits: 50,
    validityPeriod: 5,
  },
  {
    type: 'Ultra',
    valueMYR: 61000,
    valueSGD: 65000,
    totalCredits: 100,
    validityPeriod: 10,
  },
  {
    type: 'Custom',
    valueMYR: 0,
    valueSGD: 0,
    totalCredits: 0,
    validityPeriod: 0,
  },
];

const csmRoles = {
  permissions: [
    'view:campaign',
    'create:campaign',
    'update:campaign',
    'delete:campaign',
    'list:creator',
    'list:client',
    'view:client',
    'create:client',
    'update:client',
    'delete:client',
    'list:admin',
  ],
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

const clientRole = {
  permissions: ['list:campaign', 'view:campaign', 'list:creator', 'view:creator'],
};

const csLeadRole = {
  permissions: [
    'list:campaign',
    'view:campaign',
    'create:campaign',
    'update:campaign',
    'delete:campaign',
    'list:client',
    'view:client',
    'create:client',
    'update:client',
    'delete:client',
  ],
};

// Credit Tier configuration
const creditTiers = [
  { name: 'Nano A', minFollowers: 1000, maxFollowers: 5000, creditsPerVideo: 1 },
  { name: 'Nano B', minFollowers: 5001, maxFollowers: 15000, creditsPerVideo: 2 },
  { name: 'Micro A', minFollowers: 15001, maxFollowers: 30000, creditsPerVideo: 3 },
  { name: 'Micro B', minFollowers: 30001, maxFollowers: 50000, creditsPerVideo: 4 },
  { name: 'Micro C', minFollowers: 50001, maxFollowers: 100000, creditsPerVideo: 5 },
  { name: 'Macro', minFollowers: 100001, maxFollowers: null, creditsPerVideo: 8 }, // 100K+ followers - Unlimited
];

async function main() {
  // Create permissions first
  for (const scope of scopes) {
    await prisma.permisions.upsert({
      where: { name: scope.name },
      update: {},
      create: {
        name: scope.name,
        descriptions: scope.description,
      },
    });
  }
  console.log('Permissions created/updated successfully');

  // Define all roles
  const roles = [
    { name: 'CSM', permissions: csmRoles.permissions },
    { name: 'Finance', permissions: financeRole.permissions },
    { name: 'BD', permissions: bdRole.permissions },
    { name: 'Growth', permissions: growthRole.permissions },
    { name: 'Client', permissions: clientRole.permissions },
    { name: 'CSL', permissions: csLeadRole.permissions },
  ];

  // Create roles with their permissions
  for (const role of roles) {
    const existingRole = await prisma.role.findFirst({
      where: { name: role.name },
    });

    if (existingRole) {
      console.log(`${role.name} role already exists`);
      continue;
    }

    // Fetch existing permissions
    const permissions = await prisma.permisions.findMany();
    const filteredPermissions = permissions.filter((item) => role.permissions.includes(item.name));

    if (filteredPermissions.length > 0) {
      await prisma.role.create({
        data: {
          name: role.name,
          permissions: {
            connect: filteredPermissions.map((item) => ({ id: item.id })),
          },
        },
      });
      console.log(`${role.name} role created successfully`);
    } else {
      console.log(`No matching permissions found for ${role.name} role`);
    }
  }

  // Create package types
  for (const pkg of pakcagesArray) {
    let currentPackageId = '';
    let existingPackage = await prisma.package.findFirst({
      where: { name: pkg.type },
    });

    if (existingPackage) {
      const updatedPackage = await prisma.package.update({
        where: { id: existingPackage.id },
        data: {
          name: pkg.type,
          credits: pkg.totalCredits,
          validityPeriod: pkg.validityPeriod,
        },
      });

      currentPackageId = updatedPackage.id;

      console.log(`Package ${pkg.type} updated to ${pkg.totalCredits} credits`);
    } else {
      const createdPackage = await prisma.package.create({
        data: {
          name: pkg.type,
          credits: pkg.totalCredits,
          validityPeriod: pkg.validityPeriod,
        },
      });
      currentPackageId = createdPackage.id;
      console.log(`Updated Package Info: ${pkg.type}`);
    }

    await prisma.price.upsert({
      where: {
        packageId_currency: {
          packageId: currentPackageId,
          currency: 'MYR',
        },
      },
      update: { amount: pkg.valueMYR },
      create: {
        packageId: currentPackageId,
        currency: 'MYR',
        amount: pkg.valueMYR,
      },
    });

    await prisma.price.upsert({
      where: {
        packageId_currency: {
          packageId: currentPackageId,
          currency: 'SGD',
        },
      },
      update: { amount: pkg.valueSGD },
      create: {
        packageId: currentPackageId,
        currency: 'SGD',
        amount: pkg.valueSGD,
      },
    });

    console.log(`  > Prices synced for ${pkg.type} (MYR: ${pkg.valueMYR}, SGD: ${pkg.valueSGD})`);
  }

  // Create/update Credit Tiers
  console.log('\nSeeding Credit Tiers...');
  for (const tier of creditTiers) {
    await prisma.creditTier.upsert({
      where: { name: tier.name },
      update: {
        minFollowers: tier.minFollowers,
        maxFollowers: tier.maxFollowers,
        creditsPerVideo: tier.creditsPerVideo,
      },
      create: {
        name: tier.name,
        minFollowers: tier.minFollowers,
        maxFollowers: tier.maxFollowers,
        creditsPerVideo: tier.creditsPerVideo,
      },
    });
    const rangeDisplay = tier.maxFollowers
      ? `${tier.minFollowers.toLocaleString()}-${tier.maxFollowers.toLocaleString()}`
      : `${tier.minFollowers.toLocaleString()}+`;
    console.log(`  ✅ ${tier.name}: ${rangeDisplay} followers = ${tier.creditsPerVideo} credit(s)/video`);
  }
  console.log('Credit Tiers seeded successfully');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
