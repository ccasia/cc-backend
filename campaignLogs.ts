import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import { JWT } from 'google-auth-library';
import LocalizedFormat from 'dayjs/plugin/localizedFormat';

dayjs.extend(LocalizedFormat);

const prisma = new PrismaClient();

export const accessGoogleSheetAPI = async (docId: string) => {
  try {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(docId, serviceAccountAuth);

    await doc.loadInfo();

    return doc;
  } catch (error) {
    throw new Error(error);
  }
};

const campaignLogs = async () => {
  try {
    const sheet = await accessGoogleSheetAPI('1AtMHdJTBZGrzmv85UtfxT-k34I9gCl59FPul7LBjrws');

    // const asd = await test.loadInfo();
    const currentSheet = sheet.sheetsByIndex[0];

    const campaigns = await prisma.campaign.findMany({
      orderBy: {
        campaignBrief: {
          startDate: 'asc',
        },
      },
      select: {
        name: true,
        campaignBrief: {
          select: {
            startDate: true,
            endDate: true,
          },
        },
      },
    });

    await currentSheet.addRows(
      campaigns.map((item) => ({
        'Campaign Name': item.name,
        'Start Date': dayjs(item.campaignBrief?.startDate).format('LL'),
        'End Date': dayjs(item.campaignBrief?.endDate).format('LL'),
      })),
    );

    console.log('Done ✨');
  } catch (error) {
    console.log(error);
  }
};

campaignLogs();
