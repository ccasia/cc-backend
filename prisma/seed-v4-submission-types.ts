import { PrismaClient, SubmissionEnum } from '@prisma/client';

const prisma = new PrismaClient();

interface SubmissionTypeData {
  type: SubmissionEnum;
  description: string;
}

const v4SubmissionTypes: SubmissionTypeData[] = [
  {
    type: 'VIDEO' as SubmissionEnum,
    description: 'Individual video submission for V4 campaigns',
  },
  {
    type: 'PHOTO' as SubmissionEnum,
    description: 'Photo submission for V4 campaigns',
  },
  {
    type: 'RAW_FOOTAGE' as SubmissionEnum,
    description: 'Raw footage submission for V4 campaigns',
  },
];

async function seedV4SubmissionTypes() {
  try {
    console.log('🌱 Seeding V4 submission types...');

    // Check if new types already exist
    const existingTypes = await prisma.submissionType.findMany({
      where: {
        type: {
          in: v4SubmissionTypes.map((t) => t.type) as SubmissionEnum[],
        },
      },
    });

    const existingTypeValues = existingTypes.map((t) => t.type);
    const typesToCreate = v4SubmissionTypes.filter((type) => !existingTypeValues.includes(type.type as any));

    if (typesToCreate.length > 0) {
      const result = await prisma.submissionType.createMany({
        data: typesToCreate,
      });

      console.log(
        `✅ Created ${result.count} new submission types:`,
        typesToCreate.map((t) => t.type),
      );
    } else {
      console.log('✅ All V4 submission types already exist');
    }

    // List all submission types
    const allTypes = await prisma.submissionType.findMany();
    console.log('\n📋 All submission types:');
    allTypes.forEach((type) => {
      console.log(`  - ${type.type}: ${type.description || 'No description'}`);
    });
  } catch (error) {
    console.error('❌ Error seeding V4 submission types:', error);
  }
}

async function main() {
  await seedV4SubmissionTypes();
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
