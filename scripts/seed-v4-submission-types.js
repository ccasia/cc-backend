const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedV4SubmissionTypes() {
  try {
    console.log('🌱 Seeding V4 submission types...');

    // Check if new types already exist
    const existingTypes = await prisma.submissionType.findMany({
      where: {
        type: {
          in: ['VIDEO', 'PHOTO', 'RAW_FOOTAGE']
        }
      }
    });

    const existingTypeValues = existingTypes.map(t => t.type);
    const typesToCreate = [];

    // Add VIDEO type if it doesn't exist
    if (!existingTypeValues.includes('VIDEO')) {
      typesToCreate.push({
        type: 'VIDEO',
        description: 'Individual video submission for V4 campaigns'
      });
    }

    // Add PHOTO type if it doesn't exist
    if (!existingTypeValues.includes('PHOTO')) {
      typesToCreate.push({
        type: 'PHOTO',
        description: 'Photo submission for V4 campaigns'
      });
    }

    // Add RAW_FOOTAGE type if it doesn't exist
    if (!existingTypeValues.includes('RAW_FOOTAGE')) {
      typesToCreate.push({
        type: 'RAW_FOOTAGE',
        description: 'Raw footage submission for V4 campaigns'
      });
    }

    if (typesToCreate.length > 0) {
      const result = await prisma.submissionType.createMany({
        data: typesToCreate
      });

      console.log(`✅ Created ${result.count} new submission types:`, typesToCreate.map(t => t.type));
    } else {
      console.log('✅ All V4 submission types already exist');
    }

    // List all submission types
    const allTypes = await prisma.submissionType.findMany();
    console.log('\n📋 All submission types:');
    allTypes.forEach(type => {
      console.log(`  - ${type.type}: ${type.description || 'No description'}`);
    });

  } catch (error) {
    console.error('❌ Error seeding V4 submission types:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedV4SubmissionTypes();