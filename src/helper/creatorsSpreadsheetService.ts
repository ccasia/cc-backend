import { PrismaClient } from '@prisma/client';
import { accessGoogleSheetAPI } from '@services/google_sheets/sheets';

const prisma = new PrismaClient();

// Define the expected headers for the creator spreadsheet
const CREATOR_HEADERS = ['Name', 'Email', 'Phone Number', 'Country'];

/**
 * Fetches all creators from the database and exports them to Google Spreadsheet
 * Only adds new records without replacing existing ones
 * @returns Promise resolving to the spreadsheet URL
 */
export const exportCreatorsToSpreadsheet = async (): Promise<string> => {
  try {
    console.log('Starting export of creators to spreadsheet');
    
    // Get environment variables
    const SPREADSHEET_ID = process.env.REGISTERED_CREATORS_SPREADSHEET_ID;
    
    if (!SPREADSHEET_ID) {
      console.error('Missing REGISTERED_CREATORS_SPREADSHEET_ID environment variable');
      throw new Error('Missing REGISTERED_CREATORS_SPREADSHEET_ID environment variable');
    }
    
    console.log(`Using spreadsheet ID: ${SPREADSHEET_ID}`);

    // Connect to the spreadsheet
    const doc = await accessGoogleSheetAPI(SPREADSHEET_ID);
    await doc.loadInfo();
    console.log(`Connected to spreadsheet: ${doc.title}`);
    
    // Get or create the sheet
    let sheet;
    
    // Try to get the first sheet
    if (doc.sheetCount > 0) {
      sheet = doc.sheetsByIndex[0];
      console.log(`Found existing sheet: ${sheet.title}`);
      
      // Load the sheet data first to ensure headers are available
      await sheet.loadHeaderRow();
      console.log('Sheet header row loaded');
      
      // Now get the headers
      try {
        const headers = sheet.headerValues;
        console.log('Current headers:', headers);
        
        // Check if headers match expected ones
        if (!headers || headers.length === 0 || !arraysEqual(headers, CREATOR_HEADERS)) {
          await sheet.setHeaderRow(CREATOR_HEADERS);
          console.log('Headers updated successfully');
        }
      } catch (headerError) {
        console.error('Error checking headers:', headerError);
        await sheet.setHeaderRow(CREATOR_HEADERS);
        console.log('Headers set successfully');
      }
    } else {
      // No sheets exist, create a new one

      sheet = await doc.addSheet({ 
        title: 'Registered Creators', 
        headerValues: CREATOR_HEADERS 
      });
    }
    
    // Fetch all existing rows from the spreadsheet
    const existingRows = await sheet.getRows();
    console.log(`Found ${existingRows.length} existing records in spreadsheet`);
    
    // Create a set of existing emails for fast lookup
    const existingEmails = new Set();
    for (const row of existingRows) {
      if (row.get('Email')) {
        existingEmails.add(row.get('Email').trim().toLowerCase()); // Normalize emails for comparison
      }
    }
    console.log(`Found ${existingEmails.size} unique emails in spreadsheet`);
    
    // Fetch all creators from the database
    const users = await prisma.user.findMany({
      where: {
        role: 'creator',
      },
      include: {
        creator: true,
      },
    });

    // Identify new records that don't exist in the spreadsheet
    const newRows = [];
    for (const user of users) {
      const email = user.email?.trim().toLowerCase(); // Normalize for comparison
      if (email && !existingEmails.has(email)) {
        newRows.push({
          'Name': user.name || '',
          'Email': user.email || '',
          'Phone Number': user.phoneNumber || '',
          'Country': user.country || '',
        });
      }
    }
    
    // Add the new rows to the sheet
    if (newRows.length > 0) {
      await sheet.addRows(newRows);
      console.log(`Successfully added ${newRows.length} new creators to spreadsheet`);
    } else {
      console.log('No new creators to add - spreadsheet is already up to date');
    }
    
    // Return the URL of the spreadsheet
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
    console.log(`Export completed. Spreadsheet URL: ${spreadsheetUrl}`);
    return spreadsheetUrl;
  } catch (error) {
    console.error('Error in exportCreatorsToSpreadsheet:', error);
    throw error;
  }
};

/**
 * Helper function to compare two arrays for equality
 */
function arraysEqual(a: any[], b: any[]): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}