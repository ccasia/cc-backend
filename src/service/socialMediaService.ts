import axios from 'axios';

// Function to get Page ID
export const getPageId = async (accessToken: string): Promise<string> => {
  try {
    const response = await axios.get('https://graph.facebook.com/me/accounts', {
      params: {
        access_token: accessToken,
      },
    });

    if (response?.data?.data?.length < 1) throw new Error('Page not found');

    const pageId = response?.data?.data[0]?.id;

    return pageId;
  } catch (error) {
    throw new Error(error);
  }
};

// Function to get business account id
export const getInstagramBusinesssAccountId = async (accessToken: string, pageId: string): Promise<string> => {
  try {
    const response = await axios.get(`https://graph.facebook.com/${pageId}`, {
      params: {
        access_token: accessToken,
        fields: 'instagram_business_account',
      },
    });

    console.log(response);

    if (!response?.data?.instagram_business_account) throw new Error('No Instargram account is connected to the page');

    const instagramAccountId = response?.data?.instagram_business_account?.id;

    return instagramAccountId;
  } catch (error) {
    throw new Error(error);
  }
};

// Function to get instagram's user data in general
export const getInstagramUserData = async (
  accessToken: string,
  instagramId: string,
  fields: ('follows_count' | 'followers_count' | 'media' | 'media_count')[],
): Promise<{}> => {
  if (!accessToken || !instagramId || fields.length === 0) {
    throw new Error('Missing required parameters');
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/${instagramId}`, {
      params: {
        access_token: accessToken,
        fields: fields.toString(),
      },
    });

    return response?.data;
  } catch (error) {
    throw new Error(error);
  }
};

// Function to get instagram's user media data
export const getInstagramMediaData = async (
  accessToken: string,
  mediaId: string,
  fields: ('like_count' | 'media_url' | 'media_type' | 'comments_count' | 'thumbnail_url' | 'caption' | 'permalink')[],
) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/${mediaId}`, {
      params: {
        access_token: accessToken,
        fields: fields.toString(),
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(error);
  }
};

export const getInstagramAccessToken = async (code: string) => {
  if (!code) throw new Error('Code not found');
  try {
    const res = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      {
        client_id: process.env.INSTAGRAM_CLIENT_ID,
        client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
        redirect_uri: process.env.INSTAGRAM_AUTH_CALLBACK,
        grant_type: 'authorization_code',
        code: code, // The code received from the authorization server
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    console.log(res);

    const longLivedToken = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
        access_token: res.data.access_token,
      },
    });

    console.log(longLivedToken);

    const data = {
      user_id: res.data.user_id,
      permissions: res.data.permissions,
      access_token: longLivedToken.data.access_token,
      expires_in: longLivedToken.data.expires_in,
    };

    console.log(data);

    return data;
  } catch (error) {
    throw new Error(error);
  }
};

export const getInstagramOverviewService = async (accessToken: string) => {
  try {
    const res = await axios.get('https://graph.instagram.com/v22.0/me', {
      params: {
        access_token: accessToken,
        fields: 'ser_id,followers_count,follows_count,media_count',
      },
    });

    return res.data;
  } catch (error) {
    throw new Error(error);
  }
};

export const getAllMediaObject = async (
  accessToken: string,
  instaUserId: string,
  fields = ['comments_count', 'like_count', 'media_type', 'media_url', 'thumbnail_url', 'caption', 'permalink'],
) => {
  try {
    const res = await axios.get(`https://graph.instagram.com/v22.0/${instaUserId}/media`, {
      params: {
        access_token: accessToken,
        fields: fields.toString(),
      },
    });

    return res.data;
  } catch (error) {
    throw new Error(error);
  }
};
