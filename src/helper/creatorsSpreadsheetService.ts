import { PrismaClient } from '@prisma/client';
import { accessGoogleSheetAPI } from '@services/google_sheets/sheets';

const prisma = new PrismaClient();

// Define the expected headers for the creator spreadsheet
const CREATOR_HEADERS = ['Name', 'Email', 'Phone Number', 'Country'];

/**
 * Fetches all creators from the database and exports them to Google Spreadsheet
 * Creates the spreadsheet if it doesn't exist yet
 * @returns Promise resolving to the spreadsheet URL
 */
export const exportCreatorsToSpreadsheet = async (): Promise<string> => {
  try {
    // Get environment variables
    const SPREADSHEET_ID = process.env.REGISTERED_CREATORS_SPREADSHEET_ID;
    
    if (!SPREADSHEET_ID) {
      throw new Error('Missing REGISTERED_CREATORS_SPREADSHEET_ID environment variable');
    }

    // Connect to the spreadsheet
    const doc = await accessGoogleSheetAPI(SPREADSHEET_ID);
    await doc.loadInfo();
    
    // Get or create the sheet
    let sheet;
    
    // Try to get the first sheet
    if (doc.sheetCount > 0) {
      sheet = doc.sheetsByIndex[0];
      
      try {
        // Set the header row
        await sheet.setHeaderRow(CREATOR_HEADERS);
      } catch (headerError) {
        console.error('Error setting headers on existing sheet:', headerError);
        // If setting headers fails, create a new sheet
        sheet = await doc.addSheet({ 
          title: 'Registered Creators', 
          headerValues: CREATOR_HEADERS 
        });
      }
    } else {
      // No sheets exist, create a new one
      sheet = await doc.addSheet({ 
        title: 'Registered Creators', 
        headerValues: CREATOR_HEADERS 
      });
    }
    
    // Clear existing data (except headers)
    if (sheet.rowCount > 1) {
      await sheet.clearRows();
    }
    
    // Fetch all creators from the database
    const users = await prisma.user.findMany({
      where: {
        role: 'creator',
      },
      include: {
        creator: true,
      },
    });
    
    // Prepare the rows to add
    const rows = users.map(user => ({
      'Name': user.name || '',
      'Email': user.email || '',
      'Phone Number': user.phoneNumber || '',
      'Country': user.country || '',
    }));
    
    // Add the rows to the sheet
    if (rows.length > 0) {
      await sheet.addRows(rows);
    }

    console.log(`Using spreadsheet ID: ${process.env.REGISTERED_CREATORS_SPREADSHEET_ID}`);
    
    // Return the URL of the spreadsheet
    return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
  } catch (error) {
    console.error('Error exporting creators to spreadsheet:', error);
    throw error;
  }
};