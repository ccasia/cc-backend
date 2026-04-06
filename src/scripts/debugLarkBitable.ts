/**
 * Debug script to test Lark Bitable connection
 * 
 * This will help identify where the issue is:
 * 1. Test if we can get access token
 * 2. Test if we can reach the Bitable API
 * 3. Test if field names match
 * 
 * Usage:
 *   npx tsx cc-backend/src/scripts/debugLarkBitable.ts
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

interface LarkAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface LarkBitableResponse {
  code: number;
  msg: string;
  data?: any;
}

async function debugLarkBitable() {
  console.log('🔍 Starting Lark Bitable Debug...\n');

  // Step 1: Check environment variables
  console.log('📋 Step 1: Checking Environment Variables');
  console.log('==========================================');
  
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;
  const tableId = process.env.LARK_BITABLE_TABLE_ID;

  console.log(`LARK_APP_ID: ${appId ? '✅ Set' : '❌ Missing'}`);
  console.log(`LARK_APP_SECRET: ${appSecret ? '✅ Set (' + appSecret.substring(0, 5) + '...)' : '❌ Missing'}`);
  console.log(`LARK_BITABLE_APP_TOKEN: ${appToken ? '✅ ' + appToken : '❌ Missing'}`);
  console.log(`LARK_BITABLE_TABLE_ID: ${tableId ? '✅ ' + tableId : '❌ Missing'}\n`);

  if (!appId || !appSecret || !appToken || !tableId) {
    console.error('❌ Missing required environment variables. Please check your .env file.');
    process.exit(1);
  }

  try {
    // Step 2: Get access token
    console.log('🔑 Step 2: Testing Access Token');
    console.log('==========================================');
    
    // Try Singapore endpoint first, fallback to global
    const apiEndpoint = 'https://open.larksuite.com';
    console.log(`Using API endpoint: ${apiEndpoint}\n`);
    
    const tokenResponse = await axios.post<LarkAccessTokenResponse>(
      `${apiEndpoint}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        app_id: appId,
        app_secret: appSecret,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (tokenResponse.data.code !== 0 || !tokenResponse.data.tenant_access_token) {
      console.error('❌ Failed to get access token:');
      console.error(`   Code: ${tokenResponse.data.code}`);
      console.error(`   Message: ${tokenResponse.data.msg}`);
      process.exit(1);
    }

    const accessToken = tokenResponse.data.tenant_access_token;
    console.log('✅ Successfully obtained access token');
    console.log(`   Token: ${accessToken.substring(0, 20)}...\n`);

    // Step 3: List all tables in the base first
    console.log('📊 Step 3: Listing All Tables in Base');
    console.log('==========================================');
    
    const listTablesResponse = await axios.get<LarkBitableResponse>(
      `${apiEndpoint}/open-apis/bitable/v1/apps/${appToken}/tables`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (listTablesResponse.data.code !== 0) {
      console.error('❌ Failed to list tables:');
      console.error(`   Code: ${listTablesResponse.data.code}`);
      console.error(`   Message: ${listTablesResponse.data.msg}`);
      console.error('\n   This usually means:');
      console.error('   1. The APP_TOKEN is incorrect');
      console.error('   2. Your Lark app doesn\'t have permission to access this base');
      console.error('   3. The base was deleted or moved\n');
      process.exit(1);
    }

    console.log('✅ Successfully accessed base');
    const tables = listTablesResponse.data.data?.items || [];
    console.log(`   Found ${tables.length} tables:\n`);
    tables.forEach((table: any, index: number) => {
      const isTarget = table.table_id === tableId;
      console.log(`   ${index + 1}. ${table.name || 'Unnamed'} (${table.table_id}) ${isTarget ? '← TARGET' : ''}`);
    });
    
    const targetTable = tables.find((t: any) => t.table_id === tableId);
    if (!targetTable) {
      console.error(`\n❌ Table ID "${tableId}" not found in this base!`);
      console.error('   Please check your LARK_BITABLE_TABLE_ID in .env\n');
      process.exit(1);
    }
    
    console.log(`\n✅ Target table found: "${targetTable.name}"\n`);
    
    // Step 4: Get specific table info
    console.log('📊 Step 4: Fetching Table Information');
    console.log('==========================================');
    
    const tableInfoResponse = await axios.get<LarkBitableResponse>(
      `${apiEndpoint}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (tableInfoResponse.data.code !== 0) {
      console.error('❌ Failed to get table info:');
      console.error(`   Code: ${tableInfoResponse.data.code}`);
      console.error(`   Message: ${tableInfoResponse.data.msg}`);
      process.exit(1);
    }

    console.log('✅ Successfully fetched table info');
    console.log(`   Table Name: ${tableInfoResponse.data.data?.table?.name || 'Unknown'}\n`);

    // Step 5: Get table fields
    console.log('📝 Step 5: Fetching Table Fields');
    console.log('==========================================');
    
    const fieldsResponse = await axios.get<LarkBitableResponse>(
      `${apiEndpoint}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (fieldsResponse.data.code !== 0) {
      console.error('❌ Failed to get table fields:');
      console.error(`   Code: ${fieldsResponse.data.code}`);
      console.error(`   Message: ${fieldsResponse.data.msg}`);
      process.exit(1);
    }

    console.log('✅ Successfully fetched table fields\n');
    
    const fields = fieldsResponse.data.data?.items || [];
    console.log(`Found ${fields.length} fields in your Lark table:\n`);
    
    const requiredFields = {
      'User Name': { found: false, type: '' },
      'Email': { found: false, type: '' },
      'User Type': { found: false, type: '' },
      'Rating': { found: false, type: '' },
      'Feedback': { found: false, type: '' },
      'Device Type': { found: false, type: '' },
      'OS': { found: false, type: '' },
      'Browser': { found: false, type: '' },
      'Submitted At': { found: false, type: '' },
    };

    console.log('   Your Lark Table Fields:');
    console.log('   ' + '='.repeat(60));
    fields.forEach((field: any) => {
      const name = field.field_name;
      const type = field.type;
      console.log(`   - ${name} (${type})`);
      
      // Check if this matches our required fields
      if (requiredFields[name]) {
        requiredFields[name].found = true;
        requiredFields[name].type = type;
      }
    });

    console.log('\n   Expected Fields vs Your Fields:');
    console.log('   ' + '='.repeat(60));
    let allMatch = true;
    Object.entries(requiredFields).forEach(([name, status]) => {
      if (status.found) {
        console.log(`   ✅ "${name}" - Found (${status.type})`);
      } else {
        console.log(`   ❌ "${name}" - NOT FOUND`);
        allMatch = false;
      }
    });

    if (!allMatch) {
      console.log('\n⚠️  WARNING: Some required fields are missing!');
      console.log('   Please add the missing fields to your Lark table with exact names.');
      console.log('   Field names are case-sensitive!\n');
    }

    // Step 6: Test adding a record
    console.log('\n🧪 Step 6: Testing Add Record');
    console.log('==========================================');
    
    const testFields: any = {
      'User Name': 'Test User (Debug Script)',
      'Email': 'debug@test.com',
      'User Type': 'CREATOR',
      'Rating': 5,
      'Feedback': 'This is a test record from the debug script',
      'Device Type': 'Desktop',
      'OS': 'Test OS',
      'Browser': 'Test Browser',
      'Submitted At': new Date().getTime(),
    };

    console.log('Attempting to add test record with these fields:');
    Object.entries(testFields).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });

    const addRecordResponse = await axios.post<LarkBitableResponse>(
      `${apiEndpoint}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        fields: testFields,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (addRecordResponse.data.code === 0) {
      console.log('\n✅ SUCCESS! Test record added to Lark table!');
      console.log('   Check your Lark sheet - you should see the test record.');
      console.log(`   Record ID: ${addRecordResponse.data.data?.record?.record_id || 'Unknown'}`);
    } else {
      console.error('\n❌ Failed to add test record:');
      console.error(`   Code: ${addRecordResponse.data.code}`);
      console.error(`   Message: ${addRecordResponse.data.msg}`);
      
      if (addRecordResponse.data.msg.includes('field')) {
        console.error('\n   This error usually means:');
        console.error('   1. Field names don\'t match exactly (check spaces and capitalization)');
        console.error('   2. Field types don\'t match (e.g., trying to put text in a number field)');
        console.error('   3. Required field is missing a value');
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Debug Complete!');
    console.log('='.repeat(60));

    if (allMatch && addRecordResponse.data.code === 0) {
      console.log('\n✅ Everything looks good! Your Lark Bitable sync should work now.');
      console.log('   Try submitting a real NPS feedback and check if it appears in Lark.');
    } else {
      console.log('\n⚠️  There are some issues to fix. Review the errors above.');
    }

  } catch (error: any) {
    console.error('\n❌ An error occurred:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the debug
debugLarkBitable().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
