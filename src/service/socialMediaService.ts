import { encryptToken } from '@helper/encrypt';
import axios from 'axios';
import dayjs from 'dayjs';

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

// Get Long-lived token
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

    const longLivedToken = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
        access_token: res.data.access_token,
      },
    });

    const encrypToken = await encryptToken(longLivedToken.data.access_token);

    const today = dayjs();
    const expiredDate = today.add(longLivedToken.data.expires_in, 'second').unix();

    const data = {
      user_id: res.data.user_id,
      permissions: res.data.permissions,
      encryptedToken: encrypToken,
      expires_in: expiredDate,
    };

    return data;
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
};

export const refreshInstagramToken = async (accessToken: string) => {
  if (!accessToken) throw new Error('Access token is not provided');
  try {
    const refreshedToken = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: {
        grant_type: 'ig_refresh_token',
        accessToken: accessToken,
      },
    });

    return refreshedToken.data;
  } catch (error) {
    throw new Error('Error refresh instagram token');
  }
};

export const getInstagramOverviewService = async (accessToken: string) => {
  try {
    const res = await axios.get('https://graph.instagram.com/v22.0/me', {
      params: {
        access_token: accessToken,
        fields: 'user_id,followers_count,follows_count,media_count,username',
      },
    });

    return res.data;
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
};

export const getAllMediaObject = async (
  accessToken: string,
  instaUserId: string,
  limit?: number,
  fields = [
    'id',
    'comments_count',
    'like_count',
    'media_type',
    'media_url',
    'thumbnail_url',
    'caption',
    'permalink',
    'shortcode',
    'timestamp',
  ],
) => {
  try {
    const res = await axios.get(`https://graph.instagram.com/v22.0/me/media`, {
      params: {
        access_token: accessToken,
        fields: fields.toString(),
        ...(limit && { limit: limit }),
      },
    });

    const videos = res.data.data || [];

    const totalComments = videos.reduce((acc: any, cur: any) => acc + cur.comments_count, 0);
    const averageComments = totalComments / videos.length;

    const totalLikes = videos.reduce((acc: any, cur: any) => acc + cur.like_count, 0);
    const averageLikes = totalLikes / videos.length;

    // sort but highest like_count
    // let sortedVideos: any[] = videos?.sort((a: any, b: any) => a.like_count > b.like_count);
    const sortedVideos = videos.slice(0, 5);

    return { sortedVideos, averageLikes, averageComments, totalComments, totalLikes };
  } catch (error) {
    throw new Error(error);
  }
};

export const revokeInstagramPermission = async (accessToken: string, permissions?: string[]) => {
  try {
    if (permissions) {
      const res = await axios.delete('https://graph.instagram.com/v22.0/me/permissions', {
        params: {
          access_token: accessToken,
          permission: permissions.toString(),
        },
      });

      return res.data;
    }

    const res = await axios.delete('https://graph.instagram.com/v22.0/me/permissions', {
      params: {
        access_token: accessToken,
      },
    });

    return res.data;
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
};

export const calculateAverageLikes = (medias: [{ like_count: number }]) => {
  const totalLikes = medias.reduce((acc, curr) => acc + curr.like_count, 0);
  const numberOfPosts = medias.length;

  return Math.round(totalLikes / numberOfPosts) || 0;
};

export const getMediaInsight = async (accessToken: string, mediaId: string) => {
  if (!accessToken || !mediaId) throw new Error(`Missing parameters: accessToken, mediaId`);

  try {
    const response = await axios.get(`https://graph.instagram.com/v22.0/${mediaId}/insights?`, {
      params: {
        access_token: accessToken,
        metric: ['likes', 'comments', 'views', 'saved', 'shares', 'reach', 'total_interactions'],
        period: 'day',
        metric_type: 'total_value',
      },
    });

    const insights = response.data.data || [];

    const newInsights = insights.map((insight: any) => ({
      name: insight?.name,
      value: insight?.values[0]?.value || 0,
    }));

    return newInsights;
  } catch (error) {
    console.log(error);
    throw new Error(`Failed to fetch media insight: ${error}`);
  }
};

export const getInstagramMedias = async (
  accessToken: string,
  limit?: number,
  fields = [
    'id',
    'comments_count',
    'like_count',
    'media_type',
    'media_url',
    'thumbnail_url',
    'caption',
    'permalink',
    'shortcode',
    'timestamp',
  ],
) => {
  try {
    const res = await axios.get(`https://graph.instagram.com/v22.0/me/media`, {
      params: {
        access_token: accessToken,
        fields: fields.toString(),
        ...(limit && { limit: limit }),
      },
    });

    const videos = res.data.data || [];

    const totalComments = videos.reduce((acc: any, cur: any) => acc + cur.comments_count, 0);
    const averageComments = totalComments / videos.length;

    const totalLikes = videos.reduce((acc: any, cur: any) => acc + cur.like_count, 0);
    const averageLikes = totalLikes / videos.length;

    // sort but highest like_count
    // let sortedVideos: any[] = videos?.sort((a: any, b: any) => a.like_count > b.like_count);
    // const sortedVideos = videos.slice(0, 5);

    return { videos, averageLikes, averageComments, totalComments, totalLikes };
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
};

export const refreshTikTokToken = async (refreshToken: string) => {
  if (!refreshToken) throw new Error('Refresh token is not provided');

  try {
    const refreshedToken = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    return refreshedToken.data;
  } catch (error) {
    console.error('Error refreshing TikTok token:', error);
    throw new Error('Error refreshing TikTok token');
  }
};

export const getTikTokVideoById = async (accessToken: string, videoId: string) => {
  if (!accessToken || !videoId) throw new Error('Access token and video ID are required');

  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/video/query/',
      {
        filters: { video_ids: [videoId] },
      },
      {
        params: {
          fields:
            'id,title,video_description,duration,cover_image_url,embed_link,embed_html,like_count,comment_count,share_count,view_count,create_time',
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data;
  } catch (error) {
    console.error('Error fetching TikTok video by ID:', error);
    throw new Error(`Failed to fetch TikTok video: ${error}`);
  }
};

// New function to calculate TikTok engagement rates over time for charts
export const getTikTokEngagementRateOverTime = async (
  accessToken: string,
  limit = 20,
): Promise<{ engagementRates: number[]; months: string[] }> => {
  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/video/list/',
      { max_count: limit },
      {
        params: {
          fields: 'id,like_count,comment_count,create_time',
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const videos = response.data.data?.videos || [];

    if (videos.length === 0) {
      return { engagementRates: [], months: [] };
    }

    // Get follower count for engagement rate calculation
    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: {
        fields: 'follower_count',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const followersCount = userResponse.data.data.user.follower_count || 1;

    // Group videos by month and calculate engagement rates
    const monthlyData = new Map<string, { totalEngagement: number; videoCount: number }>();
    const lastThreeMonths = new Set<string>();

    // Get last 3 months
    for (let i = 0; i < 3; i++) {
      const month = dayjs().subtract(i, 'month').format('MMM');
      lastThreeMonths.add(month);
    }

    videos.forEach((video: any) => {
      const videoDate = dayjs.unix(video.create_time);
      const monthKey = videoDate.format('MMM');

      if (lastThreeMonths.has(monthKey)) {
        const engagement = (video.like_count || 0) + (video.comment_count || 0);

        if (!monthlyData.has(monthKey)) {
          monthlyData.set(monthKey, { totalEngagement: 0, videoCount: 0 });
        }

        const current = monthlyData.get(monthKey)!;
        current.totalEngagement += engagement;
        current.videoCount += 1;
      }
    });

    // Calculate engagement rates and prepare ordered data
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lastThreeMonthsArray = Array.from(lastThreeMonths).sort(
      (a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b),
    );

    const engagementRates = lastThreeMonthsArray.map((month) => {
      const data = monthlyData.get(month);
      if (!data || data.videoCount === 0) return 0;

      const avgEngagementPerVideo = data.totalEngagement / data.videoCount;
      const engagementRate = (avgEngagementPerVideo / followersCount) * 100;
      return parseFloat(engagementRate.toFixed(2));
    });

    return {
      engagementRates,
      months: lastThreeMonthsArray,
    };
  } catch (error) {
    console.error('Error calculating TikTok engagement rate over time:', error);
    return { engagementRates: [], months: [] };
  }
};

// New function to calculate TikTok monthly interactions for bar chart
export const getTikTokMonthlyInteractions = async (
  accessToken: string,
  limit = 20,
): Promise<{ monthlyData: { month: string; interactions: number }[] }> => {
  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/video/list/',
      { max_count: limit },
      {
        params: {
          fields: 'id,like_count,comment_count,create_time',
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const videos = response.data.data?.videos || [];

    if (videos.length === 0) {
      return { monthlyData: [] };
    }

    // Group videos by month and calculate total interactions
    const monthlyData = new Map<string, number>();
    const lastThreeMonths = new Set<string>();

    // Get last 3 months
    for (let i = 0; i < 3; i++) {
      const month = dayjs().subtract(i, 'month').format('MMM');
      lastThreeMonths.add(month);
    }

    videos.forEach((video: any) => {
      const videoDate = dayjs.unix(video.create_time);
      const monthKey = videoDate.format('MMM');

      if (lastThreeMonths.has(monthKey)) {
        const interactions = (video.like_count || 0) + (video.comment_count || 0);
        monthlyData.set(monthKey, (monthlyData.get(monthKey) || 0) + interactions);
      }
    });

    // Prepare ordered data
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lastThreeMonthsArray = Array.from(lastThreeMonths).sort(
      (a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b),
    );

    const formattedData = lastThreeMonthsArray.map((month) => ({
      month,
      interactions: monthlyData.get(month) || 0,
    }));

    return { monthlyData: formattedData };
  } catch (error) {
    console.error('Error calculating TikTok monthly interactions:', error);
    return { monthlyData: [] };
  }
};
