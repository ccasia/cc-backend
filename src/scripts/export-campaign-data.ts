// import { prisma } from 'src/prisma/prisma';
import { PrismaClient } from '@prisma/client';
import fs from 'fs-extra';
import path from 'path';

const prisma = new PrismaClient();

const exportData = async () => {
  const id = process.argv.slice(-1)[0];
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: id,
    },
    include: {
      shortlisted: true,
      submission: true,
      campaignRequirement: true,
      campaignBrief: true,
      insightSnapshots: true,
    },
  });

  fs.writeJSON(path.resolve(__dirname, 'test.json'), campaign, (err) => {
    console.log(err);
  });
};

exportData();
