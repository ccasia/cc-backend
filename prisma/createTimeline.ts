import { PrismaClient, SubmissionEnum } from '@prisma/client';

const prisma = new PrismaClient();

const timeline_type = [
  { name: 'Open for Pitch', for: 'creator', duration: 15 },
  { name: 'Filter Pitch', for: 'admin', duration: 2 },
  { name: 'Shortlist Creator', for: 'admin', duration: 2 },
  { name: 'Agreement', for: 'creator', duration: 1 },
  { name: 'First Draft', for: 'creator', duration: 2 },
  { name: 'Feedback First Draft', for: 'admin', duration: 2 },
  { name: 'Final Draft', for: 'creator', duration: 2 },
  { name: 'Feedback Final Draft', for: 'admin', duration: 2 },
  { name: 'QC', for: 'admin', duration: 2 },
  { name: 'Posting', for: 'creator', duration: 2 },
];

const submissionType = ['FIRST_DRAFT', 'FINAL_DRAFT', 'AGREEMENT_FORM', 'POSTING', 'OTHER'];

(async () => {
  const timelines = await Promise.all(
    timeline_type.map(async (item, index) => {
      await prisma.timelineTypeDefault.create({
        data: {
          name: item.name
            .split(' ')
            .map((e) => `${e[0].toUpperCase()}${e.slice(1)}`)
            .join(' '),
          timelineDefault: {
            create: {
              for: item.for,
              duration: item.duration,
              order: index + 1,
            },
          },
        },
      });
    }),
  );
  submissionType.forEach(async (value) => {
    await prisma.submissionType.upsert({
      where: {
        type: value as SubmissionEnum,
      },
      update: {
        type: value as SubmissionEnum,
      },
      create: {
        type: value as SubmissionEnum,
      },
    });
  });
})();
