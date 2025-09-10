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
      Date: data.date,
      Email: data.email,
    });

    return updatedRow;
  } catch (error) {
    throw new Error(error);
  }
};

export const createCampaignCreatorSpreadSheet = async ({
  spreadSheetId,
  sheetByTitle,
  data,
}: {
  spreadSheetId: string;
  sheetByTitle: string;
  data: {
    Name: string;
    Instagram?: string;
    TikTok?: string;
    Email: string;
    'Phone Number': string;
  }[];
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

    currentSheet.addRows;

    const updatedRow = await currentSheet.addRows(data);

    return updatedRow;
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
};

export const upsertSheetAndWriteRows = async ({
  spreadSheetId,
  sheetTitle,
  headerRow,
  rows,
}: {
  spreadSheetId: string;
  sheetTitle: string;
  headerRow: string[];
  rows: (string | number)[][];
}) => {
  try {
    const doc = await accessGoogleSheetAPI(spreadSheetId);

    if (!doc) {
      throw new Error('Spreadsheet not found.');
    }

    let currentSheet = doc.sheetsByTitle[sheetTitle];

    if (!currentSheet) {
      currentSheet = await doc.addSheet({ title: sheetTitle });
    }

    // Clear existing content to avoid duplicates, then set header and add rows
    if ((currentSheet as any).clear) {
      await (currentSheet as any).clear();
    }

    await currentSheet.setHeaderRow(headerRow);

    if (rows?.length) {
      // google-spreadsheet accepts array of objects or array of arrays when header is set
      await currentSheet.addRows(rows as any);
    }

    return true;
  } catch (error) {
    console.log(error);
    throw new Error(error as any);
  }
};

// async function withRetries(fn: any, retries = 3, delay = 1000) {
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       return await fn();
//     } catch (err) {
//       if (attempt === retries || err.response?.status !== 503) {
//         throw err;
//       }
//       console.warn(`Retrying (${attempt}/${retries}) after error: ${err.message}`);
//       // eslint-disable-next-line promise/param-names
//       await new Promise((res) => setTimeout(res, delay * attempt)); // exponential backoff
//     }
//   }
// }

export const addReferralData = async ({
  spreadSheetId,
  sheetByTitle,
  data,
}: {
  spreadSheetId: string;
  sheetByTitle: string;
  data: {
    name: string;
    email: string;
    phoneNumber: string;
    referralCode: string;
  };
}) => {
  try {
    console.log('Starting addReferralData with:', { spreadSheetId, sheetByTitle, data });

    console.log('Attempting to access Google Sheet API...');
    const sheet = await accessGoogleSheetAPI(spreadSheetId);
    console.log('Google Sheet accessed successfully');

    if (!sheet) {
      throw new Error('Sheet not found.');
    }

    console.log('Available sheets:', Object.keys(sheet.sheetsByTitle));
    let currentSheet = sheet.sheetsByTitle[sheetByTitle];

    if (!currentSheet) {
      // Check if Sheet1 exists and rename it to the desired name
      const sheet1 = sheet.sheetsByTitle['Sheet1'];
      if (sheet1) {
        console.log(`Renaming Sheet1 to "${sheetByTitle}"...`);
        await sheet1.updateProperties({ title: sheetByTitle });
        currentSheet = sheet1;
        console.log(`Renamed Sheet1 to: ${sheetByTitle}`);
      } else {
        console.log(`Sheet "${sheetByTitle}" not found. Creating new sheet...`);
        currentSheet = await sheet.addSheet({
          title: sheetByTitle,
          headerValues: ['Name', 'Email', 'Phone Number', 'Referral Code'],
        });
        console.log(`Created new sheet: ${sheetByTitle}`);
      }
    }

    console.log('Found target sheet, preparing to add row...');
    console.log('Adding row to sheet with data:', {
      Name: data.name,
      Email: data.email,
      'Phone Number': data.phoneNumber,
      'Referral Code': data.referralCode,
    });

    console.log('Calling addRow...');
    const updatedRow = await currentSheet.addRow({
      Name: data.name,
      Email: data.email,
      'Phone Number': data.phoneNumber,
      'Referral Code': data.referralCode,
    });

    console.log('Row added successfully:', updatedRow);
    return updatedRow;
  } catch (error) {
    console.error('Error adding referral data to Google Sheets:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    throw new Error(`Failed to add referral data: ${error}`);
  }
};

// async function batchUpdateRows(spreadsheetId: string, range: string, rows: any, chunkSize = 100) {
//   const client = await auth.getClient();
//   const chunks = [];

//   for (let i = 0; i < rows.length; i += chunkSize) {
//     chunks.push(rows.slice(i, i + chunkSize));
//   }

//   for (const chunk of chunks) {
//     const resource = {
//       data: [
//         {
//           range,
//           values: chunk,
//         },
//       ],
//       valueInputOption: 'RAW',
//     };

//     await withRetries(() =>
//       sheets.spreadsheets.values.batchUpdate({
//         spreadsheetId,
//         resource,
//         auth: client,
//       }),
//     );
//   }
// }
