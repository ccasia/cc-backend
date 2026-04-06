import axios from 'axios';

interface LarkAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

interface LarkBitableRecord {
  fields: {
    [key: string]: any;
  };
}

interface LarkBitableResponse {
  code: number;
  msg: string;
  data?: {
    record?: any;
    records?: any[];
  };
}

// Lark API endpoint - use environment variable or default to global endpoint
const LARK_API_ENDPOINT = process.env.LARK_API_ENDPOINT || 'https://open.larksuite.com';

/**
 * Get Lark tenant access token using app credentials
 */
const getLarkAccessToken = async (): Promise<string | null> => {
  try {
    const appId = process.env.LARK_APP_ID;
    const appSecret = process.env.LARK_APP_SECRET;

    if (!appId || !appSecret) {
      console.warn('⚠️  LARK_APP_ID or LARK_APP_SECRET not configured. Skipping Lark Bitable sync.');
      return null;
    }

    const response = await axios.post<LarkAccessTokenResponse>(
      `${LARK_API_ENDPOINT}/open-apis/auth/v3/tenant_access_token/internal`,
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

    if (response.data.code === 0) {
      return response.data.tenant_access_token;
    } else {
      console.error('❌ Failed to get Lark access token:', response.data.msg);
      return null;
    }
  } catch (error) {
    console.error('❌ Error getting Lark access token:', error);
    return null;
  }
};

/**
 * Add a new record to Lark Bitable
 */
const addRecordToBitable = async (
  accessToken: string,
  appToken: string,
  tableId: string,
  fields: { [key: string]: any }
): Promise<boolean> => {
  try {
    const response = await axios.post<LarkBitableResponse>(
      `${LARK_API_ENDPOINT}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        fields,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.code === 0) {
      console.log('✅ Successfully added record to Lark Bitable');
      return true;
    }
    const code = response.data.code;
    const msg = response.data.msg;
    console.error('❌ Failed to add record to Lark Bitable:', { code, msg });
    if (code === 91403) {
      console.error(
        '   → 91403 Forbidden: The app does not have edit permission on this Base. ' +
          'In Lark: open the Base → Share (or ⋮) → Add people/apps → add your app with "Can edit" (or use Advanced permissions to grant the app access). ' +
          'Also ensure the app has scope "bitable:app" in Developer Console → Permissions & Scopes.'
      );
    }
    return false;
  } catch (error: any) {
    console.error('❌ Error adding record to Lark Bitable:', error.response?.data || error.message);
    return false;
  }
};

/**
 * Sync NPS feedback to Lark Bitable
 */
export const syncNpsFeedbackToLark = async (feedbackData: {
  userName?: string;
  userEmail?: string;
  userType: 'CLIENT' | 'CREATOR';
  rating: number;
  feedback?: string;
  deviceType?: string;
  os?: string;
  browser?: string;
  timestamp: string;
}): Promise<boolean> => {
  try {
    const appToken = process.env.LARK_BITABLE_APP_TOKEN;
    const tableId = process.env.LARK_BITABLE_TABLE_ID;

    if (!appToken || !tableId) {
      console.warn('⚠️  LARK_BITABLE_APP_TOKEN or LARK_BITABLE_TABLE_ID not configured. Skipping Lark Bitable sync.');
      return false;
    }

    // Get access token
    const accessToken = await getLarkAccessToken();
    if (!accessToken) {
      return false;
    }

    // Prepare the record fields
    // Note: Field names must match exactly with your Lark Bitable column names
    const fields = {
      'User Name': feedbackData.userName || 'Anonymous',
      'Email': feedbackData.userEmail || 'N/A',
      'User Type': feedbackData.userType,
      'Rating': feedbackData.rating,
      'Feedback': feedbackData.feedback || '',
      'Device Type': feedbackData.deviceType || '',
      'OS': feedbackData.os || '',
      'Browser': feedbackData.browser || '',
      'Submitted At': new Date(feedbackData.timestamp).getTime(), // Convert to timestamp (milliseconds)
    };

    // Add record to Bitable
    const success = await addRecordToBitable(accessToken, appToken, tableId, fields);
    
    if (success) {
      console.log('✅ NPS feedback synced to Lark Bitable successfully');
    }
    
    return success;
  } catch (error) {
    console.error('❌ Error syncing NPS feedback to Lark Bitable:', error);
    return false;
  }
};

/**
 * Batch sync multiple NPS feedbacks to Lark Bitable
 */
export const batchSyncNpsFeedbackToLark = async (
  feedbacks: Array<{
    userName?: string;
    userEmail?: string;
    userType: 'CLIENT' | 'CREATOR';
    rating: number;
    feedback?: string;
    deviceType?: string;
    os?: string;
    browser?: string;
    timestamp: string;
  }>
): Promise<{ success: number; failed: number }> => {
  let success = 0;
  let failed = 0;

  for (const feedback of feedbacks) {
    const result = await syncNpsFeedbackToLark(feedback);
    if (result) {
      success++;
    } else {
      failed++;
    }
    // Add a small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`📊 Batch sync completed: ${success} succeeded, ${failed} failed`);
  return { success, failed };
};
