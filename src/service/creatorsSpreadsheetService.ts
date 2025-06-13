import { PrismaClient } from '@prisma/client';
import { accessGoogleSheetAPI } from '@services/google_sheets/sheets';
import { formatDateTimeMY } from '@helper/formateDateTime';

const prisma = new PrismaClient();

// Define the expected headers for the creator spreadsheet
const CREATOR_HEADERS = ['Name', 'Email', 'Phone Number', 'Country', 'Date Registered', 'Social Handle'];

// Rate limiting constants
const BATCH_SIZE = 500; // Process users in batches
const DELAY_BETWEEN_BATCHES = 200; // 2 seconds delay between batches
const MAX_RETRIES = 3;

/**
 * Sleep utility function
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry wrapper for API calls
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Exponential backoff for rate limit errors
      const isRateLimit = error.message?.includes('429') || error.message?.includes('Quota exceeded');
      const backoffDelay = isRateLimit ? delay * Math.pow(2, attempt) : delay;
      
      console.log(`Retrying in ${backoffDelay}ms...`);
      await sleep(backoffDelay);
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Batch update rows in Google Sheets using the Sheets API directly
 */
async function batchUpdateSpreadsheet(
  spreadsheetId: string,
  sheetName: string,
  updates: Array<{ row: number; values: string[] }>
) {
  if (updates.length === 0) return;

  try {
    const { JWT } = await import('google-auth-library');
    
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Get access token for direct API calls
    const { token } = await serviceAccountAuth.getAccessToken();
    
    // Prepare batch update requests
    const requests = updates.map(update => ({
      range: `'${sheetName}'!A${update.row}:F${update.row}`,
      values: [update.values]
    }));

    // Split into smaller chunks to avoid hitting limits
    const chunks = [];
    for (let i = 0; i < requests.length; i += 100) {
      chunks.push(requests.slice(i, i + 100));
    }

    console.log(`Updating ${updates.length} rows in ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      await withRetry(async () => {
        const response = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              valueInputOption: 'USER_ENTERED',
              data: chunk
            })
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Google API error - [${response.status}] ${errorData.error?.message || response.statusText}`);
        }

        return response.json();
      });

      console.log(`Completed chunk ${i + 1}/${chunks.length}`);
      
      // Add delay between chunks
      if (i < chunks.length - 1) {
        await sleep(500);
      }
    }

    console.log(`Successfully updated ${updates.length} rows`);
  } catch (error) {
    console.error('Error in batch update:', error);
    throw error;
  }
}

/**
 * Batch add new rows to Google Sheets
 */
async function batchAddRows(
  spreadsheetId: string,
  sheetName: string,
  newRows: Array<Record<string, string>>
) {
  if (newRows.length === 0) return;

  const chunks = [];
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    chunks.push(newRows.slice(i, i + BATCH_SIZE));
  }

  console.log(`Adding ${newRows.length} new rows in ${chunks.length} chunks`);

  const doc = await accessGoogleSheetAPI(spreadsheetId);
  const sheet = doc.sheetsByTitle[sheetName] || doc.sheetsByIndex[0];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    await withRetry(async () => {
      await sheet.addRows(chunk);
    });

    console.log(`Added chunk ${i + 1}/${chunks.length} (${chunk.length} rows)`);
    
    // Add delay between chunks
    if (i < chunks.length - 1) {
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  console.log(`Successfully added ${newRows.length} new rows`);
}

/**
 * Fetches all creators from the database and exports them to Google Spreadsheet
 * Optimized with batch operations and rate limiting
 */
export const exportCreatorsToSpreadsheet = async (): Promise<string> => {
  try {
    console.log('Starting optimized export of creators to spreadsheet');

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
    let sheetName = 'Production';

    if (doc.sheetCount > 0) {
      sheet = doc.sheetsByIndex[0];
      sheetName = sheet.title;
      console.log(`Found existing sheet: ${sheetName}`);

      await sheet.loadHeaderRow();
      console.log('Sheet header row loaded');

      try {
        const headers = sheet.headerValues;
        console.log('Current headers:', headers);

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
      sheet = await doc.addSheet({
        title: 'Registered Creators',
        headerValues: CREATOR_HEADERS,
      });
      sheetName = sheet.title;
    }

    // Fetch all existing rows from the spreadsheet
    console.log('Loading existing spreadsheet data...');
    const existingRows = await sheet.getRows();
    console.log(`Found ${existingRows.length} existing records in spreadsheet`);

    // Create a map of existing data for fast lookup
    const existingDataMap = new Map();
    const rowsToUpdate: Array<{ row: number; values: string[] }> = [];

    for (let i = 0; i < existingRows.length; i++) {
      const row = existingRows[i];
      const email = row.get('Email')?.trim().toLowerCase();
      
      if (email) {
        const currentDate = row.get('Date Registered');
        const currentSocialHandle = row.get('Social Handle');
        
        existingDataMap.set(email, {
          row: i + 2, // +2 because spreadsheet is 1-indexed and has header row
          needsUpdate: !currentDate || !currentSocialHandle,
          existingRow: row
        });
      }
    }

    console.log(`Found ${existingDataMap.size} unique emails in spreadsheet`);

    // Fetch all creators from the database in batches
    console.log('Fetching creators from database...');
    const totalCreators = await prisma.user.count({
      where: { role: 'creator' }
    });
    
    console.log(`Total creators in database: ${totalCreators}`);

    const newRowsToAdd: Array<Record<string, string>> = [];
    let processedCount = 0;
    const dbBatchSize = 500; // Fetch from DB in larger batches

    for (let offset = 0; offset < totalCreators; offset += dbBatchSize) {
      const users = await prisma.user.findMany({
        where: {
          role: 'creator',
        },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          country: true,
          createdAt: true,
          creator: {
            include: {
              instagramUser: {
                select: {
                  username: true,
                },
              },
              tiktokUser: {
                select: {
                  display_name: true,
                },
              },
            },
          },
        },
        skip: offset,
        take: dbBatchSize,
      });

      console.log(`Processing batch ${Math.floor(offset/dbBatchSize) + 1}: ${users.length} users`);

      for (const user of users) {
        const email = user.email?.trim().toLowerCase();
        if (!email) continue;

        // Get social handles
        const socialHandles = [];
        if (user.creator?.instagramUser?.username) {
          socialHandles.push(`IG: ${user.creator.instagramUser.username}`);
        }
        if (user.creator?.tiktokUser?.display_name) {
          socialHandles.push(`TT: ${user.creator.tiktokUser.display_name}`);
        }
        const socialHandlesString = socialHandles.join(' / ');

        const existingData = existingDataMap.get(email);
        
        if (existingData) {
          // Check if update is needed
          if (existingData.needsUpdate) {
            rowsToUpdate.push({
              row: existingData.row,
              values: [
                user.name || '',
                user.email || '',
                user.phoneNumber || '',
                user.country || '',
                formatDateTimeMY(user.createdAt),
                socialHandlesString || ''
              ]
            });
          }
        } else {
          // New user to add
          newRowsToAdd.push({
            Name: user.name || '',
            Email: user.email || '',
            'Phone Number': user.phoneNumber || '',
            Country: user.country || '',
            'Date Registered': formatDateTimeMY(user.createdAt),
            'Social Handle': socialHandlesString || '',
          });
        }

        processedCount++;
      }

      // Add small delay between database batches
      if (offset + dbBatchSize < totalCreators) {
        await sleep(100);
      }
    }

    console.log(`Processed ${processedCount} creators from database`);
    console.log(`Found ${rowsToUpdate.length} rows to update`);
    console.log(`Found ${newRowsToAdd.length} new rows to add`);

    // Batch update existing rows
    if (rowsToUpdate.length > 0) {
      console.log('Starting batch update of existing rows...');
      await batchUpdateSpreadsheet(SPREADSHEET_ID, sheetName, rowsToUpdate);
    }

    // Batch add new rows
    if (newRowsToAdd.length > 0) {
      console.log('Starting batch add of new rows...');
      await batchAddRows(SPREADSHEET_ID, sheetName, newRowsToAdd);
    }

    // Log summary
    console.log(`Export completed successfully!`);
    console.log(`- Updated: ${rowsToUpdate.length} existing records`);
    console.log(`- Added: ${newRowsToAdd.length} new records`);
    console.log(`- Total processed: ${processedCount} creators`);

    // Return the URL of the spreadsheet
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
    console.log(`Spreadsheet URL: ${spreadsheetUrl}`);
    return spreadsheetUrl;
  } catch (error) {
    console.error('Error in exportCreatorsToSpreadsheet:', error);
    throw new Error(`Failed to export creators: ${error.message}`);
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