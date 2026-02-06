import { prisma } from 'src/prisma/prisma';
import fs from 'fs-extra';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

async function exportCampaignData() {
  const campaigns = await prisma.campaign.findMany({
    include: {
      campaignBrief: true,
      campaignAdditionalDetails: true,
      campaignRequirement: true,
    },
  });

  const cleanedCampaigns = campaigns.map((campaign) => {
    const { campaignBrief, ...rest } = campaign;

    return {
      ...rest,
      ...campaignBrief,

      // IMPORTANT: stringify relations
      campaignAdditionalDetails: JSON.stringify(campaign.campaignAdditionalDetails),
      campaignRequirement: JSON.stringify(campaign.campaignRequirement),
    };
  });

  if (!cleanedCampaigns.length) {
    console.log('No data to export');
    return;
  }

  const filePath = path.resolve(__dirname, 'test.csv');

  const headers = Object.keys(cleanedCampaigns[0]).map((key) => ({
    id: key,
    title: key,
  }));

  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: headers,
  });

  await csvWriter.writeRecords(cleanedCampaigns);

  console.log('CSV export DONE');

  //   const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });

  //   writeStream.on('finish', () => {
  //     console.log('DONE');
  //   });

  //   writeStream.on('error', (err) => {
  //     console.error('Write failed:', err);
  //   });

  //   writeStream.write(JSON.stringify(rows, null, 2));
  //   writeStream.end();
}

exportCampaignData().catch((err) => {
  console.log(err);
  process.exit(1);
});
