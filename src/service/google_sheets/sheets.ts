import dayjs from 'dayjs';
import { JWT } from 'google-auth-library';

import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

interface NewSheetWithRows {
  title: string;
  rows: string[];
}

interface Row {
  spreadSheetId: string;
  creatorInfo: {
    name: string;
    username: string;
    postingDate: string;
    caption: string;
    videoLink: string;
  };
}

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

export const createNewRowData = async ({ spreadSheetId, creatorInfo }: Row) => {
  try {
    const sheet = await accessGoogleSheetAPI(spreadSheetId);

    if (!sheet) {
      throw new Error('Sheet not found.');
    }

    const currentSheet = sheet.sheetsByIndex[0];

    if (!currentSheet) {
      throw new Error('Sheet not found.');
    }

    const updatedRow = await currentSheet.addRow({
      Name: creatorInfo.name,
      Username: creatorInfo.username,
      'Video Link': creatorInfo.videoLink,
      'Posting Date': creatorInfo.postingDate,
      Caption: creatorInfo.caption,
    });

    return updatedRow;
  } catch (error) {
    throw new Error(error);
  }
};

export const createNewSpreadSheet = async ({ title }: { title: string }) => {
  try {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });

    const doc = await GoogleSpreadsheet.createNewSpreadsheetDocument(serviceAccountAuth, { title: title || 'Default' });

    const sheet = doc.sheetsByIndex[0];
    sheet.setHeaderRow(['Name', 'Username', 'Video Link', 'Posting Date', 'Caption', 'Video Feedback', 'Others']);

    // Testing purpose
    // await doc.share('afiq@nexea.co');
    await doc.share('atiqah@cultcreative.asia');

    const url = `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/`;

    return url;
  } catch (error) {
    throw new Error(error);
  }
};

export const createNewBugRowData = async ({
  spreadSheetId,
  sheetByTitle,
  data,
}: {
  spreadSheetId: string;
  sheetByTitle: 'Platform Creator Bugs' | 'Platform Admin Bugs';
  data: {
    createdAt: string;
    email?: string;
    name?: string;
    campaignName?: string;
    stepsToReproduce: string;
    attachment?: string;
  };
}) => {
  try {
    const sheet = await accessGoogleSheetAPI(spreadSheetId);

    if (!sheet) {
      throw new Error('Sheet not found.');
    }

    const currentSheet = sheet.sheetsByTitle[sheetByTitle];

    if (!currentSheet) {
      throw new Error('Sheet not found.');
    }

    const updatedRow = await currentSheet.addRow({
      Timestamp: dayjs(data.createdAt).tz('Asia/Kuala_Lumpur').format('LLL'),
      'Email Address': data.email || '',
      Name: data.name || '',
      Campaign: data.campaignName || '',
      'Please describe the issue you are facing in detail.': data.stepsToReproduce,
      Attachments: data.attachment || '',
    });

    return updatedRow;
  } catch (error) {
    throw new Error(error);
  }
};

export const createNewKWSPRowData = async ({
  spreadSheetId,
  sheetByTitle,
  data,
}: {
  spreadSheetId: string;
  sheetByTitle: string;
  data: {
    fullName: string;
    nricPassport: string;
    date: string;
    email: string;
  };
}) => {
  try {
    const sheet = await accessGoogleSheetAPI(spreadSheetId);

    if (!sheet) {
      throw new Error('Sheet not found.');
    }

    const currentSheet = sheet.sheetsByTitle[sheetByTitle];

    if (!currentSheet) {
      throw new Error('Sheet not found.');
    }

    const updatedRow = await currentSheet.addRow({
      'Full Name': data.fullName,
      'NRIC/Passport Number': `'${data.nricPassport}`,
      'Date': data.date,
      'Email': data.email,
    });

    return updatedRow;
  } catch (error) {
    throw new Error(error);
  }
};