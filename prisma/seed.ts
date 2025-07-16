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
    type: 'Trail',
    valueMYR: 2800,
    valueSGD: 3100,
    totalCredits: 5,
    validityPeriod: 1,
  },
  {
    type: 'Basic',
    valueMYR: 8000,
    valueSGD: 8900,
    totalCredits: 15,
    validityPeriod: 2,
  },
  {
    type: 'Essential',
    valueMYR: 15000,
    valueSGD: 17500,
    totalCredits: 30,
    validityPeriod: 3,
  },
  {
    type: 'Pro',
    valueMYR: 23000,
    valueSGD: 29000,
    totalCredits: 50,
    validityPeriod: 5,
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

async function main() {
  // Check if Client role already exists
  const existingClientRole = await prisma.role.findFirst({
    where: {
      name: 'Client',
    },
  });

  if (existingClientRole) {
    console.log('Client role already exists');
    return;
  }

  // Fetch existing permissions
  const permissions = await prisma.permisions.findMany();
  
  // Create Client Role
  const clientPermissions = clientRole.permissions;
  const filteredClientPermissions = permissions.filter((item) => clientPermissions.includes(item.name));
  
  if (filteredClientPermissions.length > 0) {
    await prisma.role.create({
      data: {
        name: 'Client',
        permissions: {
          connect: filteredClientPermissions.map((item) => ({ id: item.id })),
        },
      },
    });
    console.log('Client role created successfully');
  } else {
    console.log('No matching permissions found for Client role');
  }
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