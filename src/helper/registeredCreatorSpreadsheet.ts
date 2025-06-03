import { accessGoogleSheetAPI } from '@services/google_sheets/sheets';
import formatDateTime from './formateDateTime';

interface CreatorData {
  name: string;
  email: string;
  phoneNumber: string;
  country: string;
  createdAt: Date;
}

// Define the expected headers for the creator spreadsheet
const CREATOR_HEADERS = ['Name', 'Email', 'Phone Number', 'Country', 'Date Registered', 'Social Handle'];

const title = process.env.NODE_ENV === 'production' ? 'Production' : 'Staging';

/**
 * Save registered creator information to Google Spreadsheet
 * @param creatorData Object containing creator information
 * @returns Promise resolving to boolean indicating success/failure
 */
export const saveCreatorToSpreadsheet = async (creatorData: CreatorData): Promise<boolean> => {
  try {
    // Get environment variables
    const SPREADSHEET_ID = process.env.REGISTERED_CREATORS_SPREADSHEET_ID;

    if (!SPREADSHEET_ID) {
      console.error('Missing REGISTERED_CREATORS_SPREADSHEET_ID environment variable');
      return false;
    }

    const doc = await accessGoogleSheetAPI(SPREADSHEET_ID);
    await doc.loadInfo();
    console.log(`Spreadsheet title: ${doc.title}`);

    let sheet;

    // Check if there are any existing sheets
    if (doc.sheetCount > 0) {
      sheet = doc.sheetsByTitle[title];
      console.log(`Using existing sheet: ${sheet.title}`);

      try {
        await sheet.setHeaderRow(CREATOR_HEADERS);
        console.log('Updated headers on existing sheet');
      } catch (headerError) {
        console.error('Error setting headers on existing sheet:', headerError);
        // If setting headers fails, try creating a new sheet
        sheet = await doc.addSheet({
          title: 'Registered Creators',
          headerValues: CREATOR_HEADERS,
        });
        console.log('Created new sheet with headers after error');
      }
    } else {
      // No sheets exist, create a new one
      sheet = await doc.addSheet({
        title: 'Registered Creators',
        headerValues: CREATOR_HEADERS,
      });
      console.log('Created new sheet with headers');
    }

    // After ensuring headers exist, add the new row
    // Match the property names exactly to the headers
    await sheet.addRow({
      Name: creatorData.name || '',
      Email: creatorData.email || '',
      'Phone Number': creatorData.phoneNumber || '',
      Country: creatorData.country || '',
      'Date Registered': formatDateTime(new Date()),
    });

    console.log(`Successfully added creator ${creatorData.name} to spreadsheet`);
    return true;
  } catch (error) {
    console.error('Error saving creator to spreadsheet:', error);
    return false;
  }
};
