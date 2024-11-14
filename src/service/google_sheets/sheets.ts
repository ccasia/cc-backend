import { JWT } from 'google-auth-library';

interface NewSheetWithRows {
  title: string;
  rows: string[];
}

interface Row {
  sheetId: number;
  creatorInfo: {
    name: string;
    username: string;
    postingDate: string;
    caption: string;
    videoLink: string;
  };
}

export const accessGoogleSheetAPI = async () => {
  try {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet('1k-0MzP1vQUltu_DacbwzagmHi-_J2924g7NN5J6ptBM', serviceAccountAuth);

    await doc.loadInfo();

    return doc;
  } catch (error) {
    throw new Error(error);
  }
};

// Create Campaign = Sheet
export const createNewSheetWithHeaderRows = async ({ title, rows }: NewSheetWithRows) => {
  try {
    const sheet = await accessGoogleSheetAPI();

    const newSheet = await sheet.addSheet({ headerValues: rows, title: title });

    return newSheet;
  } catch (error) {
    throw new Error(error);
  }
};

// Insert shortlisted creator => row
export const createNewRowData = async ({ sheetId, creatorInfo }: Row) => {
  try {
    const sheet = await accessGoogleSheetAPI();

    const existingSheet = sheet.sheetsById[sheetId];

    if (!existingSheet) {
      throw new Error('Sheet not found.');
    }

    const updatedRow = await existingSheet.addRow({
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

export const getLastRow = async ({ sheetId }: { sheetId: number }) => {
  try {
    const doc = await accessGoogleSheetAPI();

    const sheet = doc.sheetsById[sheetId];

    const rows = await sheet.getRows();

    const lastRowIndex = rows.length;

    console.log(`Last row with data is at index: ${lastRowIndex}`);

    console.log(lastRowIndex);
    return lastRowIndex;
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

    // Testing purpose
    await doc.share('afiq@nexea.co');
    // await doc.share('atiqah@cultcreative.asia');

    const url = `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/`;

    return url;
  } catch (error) {
    throw new Error(error);
  }
};
