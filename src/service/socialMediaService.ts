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

    if (!response?.data?.instagram_business_account) throw new Error('No Instagram account is connected to the page');

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
        fields: 'user_id,profile_picture_url,biography,followers_count,follows_count,media_count,username',
      },
    });

    return res.data;
  } catch (error) {
    throw new Error(error);
  }
};

export const getInstagramUserInsight = async (accessToken: string, instagramUserId: string) => {
  if (!accessToken || !instagramUserId) {
    throw new Error('Missing required parameters: accessToken, instagramUserId');
  }

  const since = dayjs().subtract(2, 'year').unix();
  const until = dayjs().unix();

  try {
    const response = await axios.get(`https://graph.instagram.com/v22.0/${instagramUserId}/insights`, {
      params: {
        metric: 'likes,saves,shares,reach,total_interactions,profile_views,comments,accounts_engaged',
        period: 'day',
        metric_type: 'total_value',
        since,
        until,
        access_token: accessToken,
      },
    });

    const metrics = (response?.data?.data || []) as Array<{ name: string; total_value?: { value?: number } }>;

    const metricMap = metrics.reduce(
      (acc, item) => {
        acc[item.name] = item?.total_value?.value || 0;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      raw: response?.data,
      since,
      until,
      totals: {
        likes: metricMap.likes || 0,
        saves: metricMap.saves || 0,
        shares: metricMap.shares || 0,
        reach: metricMap.reach || 0,
        totalInteractions: metricMap.total_interactions || 0,
        profileViews: metricMap.profile_views || 0,
        comments: metricMap.comments || 0,
        accountsEngaged: metricMap.accounts_engaged || 0,
      },
    };
  } catch (error: any) {
    console.error('Error fetching Instagram user insight:', error?.response?.data || error?.message);
    throw new Error('Failed to fetch Instagram user insights');
  }
};

export const getInstagramMediaObject = async (
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
    console.log('Full error message:', error.response.data);
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


    const mediaTypeBreakdown = (videos || []).reduce((acc: Record<string, number>, video: any) => {
      const type = String(video?.media_type || 'UNKNOWN');
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    console.log('[Discovery][Debug] getInstagramMedias response', {
      requestedLimit: limit || null,
      returnedCount: videos.length,
      hasPagingNext: Boolean(res?.data?.paging?.next),
      withMediaUrlCount: videos.filter((video: any) => Boolean(video?.media_url)).length,
      withThumbnailCount: videos.filter((video: any) => Boolean(video?.thumbnail_url)).length,
      withPermalinkCount: videos.filter((video: any) => Boolean(video?.permalink)).length,
      mediaTypeBreakdown,
    });


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

export const getTikTokMediaObject = async (accessToken: string, limit = 20) => {
  if (!accessToken) throw new Error('Access token is required');

  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/video/list/',
      { max_count: limit },
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

    const videos = response.data.data?.videos || [];

    const mappedVideos = videos.map((video: any) => ({
      ...video,
      like: video.like_count || 0,
      comment: video.comment_count || 0,
      share: video.share_count || 0,
      view: video.view_count || 0,
      like_count: video.like_count || 0,
      comment_count: video.comment_count || 0,
      share_count: video.share_count || 0,
      view_count: video.view_count || 0,
    }));

    const sortedVideos = [...mappedVideos]
      .sort((a: any, b: any) => {
        const aTime = a?.create_time ? Number(a.create_time) : 0;
        const bTime = b?.create_time ? Number(b.create_time) : 0;
        return bTime - aTime;
      })
      .slice(0, 5);

    const totalLikes = mappedVideos.reduce((sum: number, video: any) => sum + (video.like_count || 0), 0);
    const totalComments = mappedVideos.reduce((sum: number, video: any) => sum + (video.comment_count || 0), 0);
    const totalShares = mappedVideos.reduce((sum: number, video: any) => sum + (video.share_count || 0), 0);
    const totalViews = mappedVideos.reduce((sum: number, video: any) => sum + (video.view_count || 0), 0);

    const averageLikes = mappedVideos.length > 0 ? totalLikes / mappedVideos.length : 0;
    const averageComments = mappedVideos.length > 0 ? totalComments / mappedVideos.length : 0;
    const averageShares = mappedVideos.length > 0 ? totalShares / mappedVideos.length : 0;
    const averageViews = mappedVideos.length > 0 ? totalViews / mappedVideos.length : 0;

    return {
      videos: mappedVideos,
      sortedVideos,
      totalLikes,
      totalComments,
      totalShares,
      totalViews,
      averageLikes,
      averageComments,
      averageShares,
      averageViews,
    };
  } catch (error) {
    throw error;
  }
};

// Helper function to resolve TikTok short codes (e.g., ZS5NQoDLq) to full video IDs
export const resolveTikTokShortCode = async (shortCode: string): Promise<string> => {
  try {
    console.log(`🔗 Resolving TikTok short code: ${shortCode}`);
    
    // Short codes are typically 10-15 characters of alphanumeric/underscore/hyphen
    // If it's already a long numeric ID, return it as-is
    if (/^\d{15,}$/.test(shortCode)) {
      console.log(`✅ Already a full video ID: ${shortCode}`);
      return shortCode;
    }

    // Try to resolve the short code by following the redirect
    const shortUrl = `https://vt.tiktok.com/${shortCode}`;
    const response = await axios.get(shortUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status === 301 || status === 302 || status === 307 || status === 308,
    });

    const location = response.headers.location;
    if (!location) {
      throw new Error('Could not resolve short code redirect');
    }

    console.log(`📍 Redirect location: ${location}`);

    // Extract video ID from the full URL
    // Format: https://www.tiktok.com/@username/video/7518082807227223314
    const videoIdMatch = location.match(/\/video\/(\d+)/);
    if (videoIdMatch && videoIdMatch[1]) {
      console.log(`✅ Resolved to video ID: ${videoIdMatch[1]}`);
      return videoIdMatch[1];
    }

    // If redirect doesn't work, try using the short code directly as it might be a share ID
    // Some TikTok endpoints accept share IDs
    console.log(`⚠️ Could not extract video ID from redirect, returning original short code`);
    return shortCode;
  } catch (error) {
    console.error(`❌ Error resolving TikTok short code: ${error.message}`);
    // Return the short code anyway - might still work with some API endpoints
    return shortCode;
  }
};

export const getTikTokVideoById = async (accessToken: string, videoId: string) => {
  if (!accessToken || !videoId) throw new Error('Access token and video ID are required');

  try {
    // Resolve short codes to full video IDs
    let resolvedVideoId = videoId;
    if (!/^\d{15,}$/.test(videoId)) {
      console.log(`🔍 Detected possible short code, attempting to resolve: ${videoId}`);
      resolvedVideoId = await resolveTikTokShortCode(videoId);
    }

    console.log(`📤 Querying TikTok API with video ID: ${resolvedVideoId}`);

    const response = await axios.post(
      'https://open.tiktokapis.com/v2/video/query/',
      {
        filters: { video_ids: [resolvedVideoId] },
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

interface InstagramPost {
  id: string;
  like_count?: number;
  comments_count?: number;
  timestamp: string;
}

// New function to calculate engagement rates over time for charts
export const getInstagramEngagementRateOverTime = async (
  accessToken: string,
  limit = 25,
): Promise<{ engagementRates: number[]; months: string[] }> => {
  try {
    const response = await axios.get('https://graph.instagram.com/v22.0/me/media', {
      params: {
        access_token: accessToken,
        fields: 'id,like_count,comments_count,timestamp',
        limit: limit,
      },
    });

    const posts: InstagramPost[] = response.data.data || [];

    if (posts.length === 0) {
      return { engagementRates: [], months: [] };
    }

    // Get follower count for engagement rate calculation
    const userResponse = await axios.get('https://graph.instagram.com/v22.0/me', {
      params: {
        access_token: accessToken,
        fields: 'followers_count',
      },
    });

    const followersCount = userResponse.data.followers_count || 1;

    // Group posts by month and calculate engagement rates
    const monthlyData = new Map<string, { totalEngagement: number; postCount: number }>();
    const lastThreeMonths = new Set<string>();

    // Get last 3 months
    for (let i = 0; i < 3; i++) {
      const month = dayjs().subtract(i, 'month').format('MMM');
      lastThreeMonths.add(month);
    }

    posts.forEach((post) => {
      const postDate = dayjs(post.timestamp);
      const monthKey = postDate.format('MMM');

      if (lastThreeMonths.has(monthKey)) {
        const engagement = (post.like_count || 0) + (post.comments_count || 0);

        if (!monthlyData.has(monthKey)) {
          monthlyData.set(monthKey, { totalEngagement: 0, postCount: 0 });
        }

        const current = monthlyData.get(monthKey)!;
        current.totalEngagement += engagement;
        current.postCount += 1;
      }
    });

    // Calculate engagement rates and prepare ordered data
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lastThreeMonthsArray = Array.from(lastThreeMonths).sort(
      (a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b),
    );

    const engagementRates = lastThreeMonthsArray.map((month) => {
      const data = monthlyData.get(month);
      if (!data || data.postCount === 0) return 0;

      const avgEngagementPerPost = data.totalEngagement / data.postCount;
      const engagementRate = (avgEngagementPerPost / followersCount) * 100;
      return parseFloat(engagementRate.toFixed(2));
    });

    return {
      engagementRates,
      months: lastThreeMonthsArray,
    };
  } catch (error) {
    console.error('Error calculating Instagram engagement rate over time:', error);
    return { engagementRates: [], months: [] };
  }
};

// New function to calculate monthly interactions for bar chart
export const getInstagramMonthlyInteractions = async (
  accessToken: string,
  limit = 25,
): Promise<{ monthlyData: { month: string; interactions: number }[] }> => {
  try {
    const response = await axios.get('https://graph.instagram.com/v22.0/me/media', {
      params: {
        access_token: accessToken,
        fields: 'id,like_count,comments_count,timestamp',
        limit: limit,
      },
    });

    const posts: InstagramPost[] = response.data.data || [];

    if (posts.length === 0) {
      return { monthlyData: [] };
    }

    // Group posts by month and calculate total interactions
    const monthlyData = new Map<string, number>();
    const lastThreeMonths = new Set<string>();

    // Get last 3 months
    for (let i = 0; i < 3; i++) {
      const month = dayjs().subtract(i, 'month').format('MMM');
      lastThreeMonths.add(month);
    }

    posts.forEach((post) => {
      const postDate = dayjs(post.timestamp);
      const monthKey = postDate.format('MMM');

      if (lastThreeMonths.has(monthKey)) {
        const interactions = (post.like_count || 0) + (post.comments_count || 0);
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
    console.error('Error calculating Instagram monthly interactions:', error);
    return { monthlyData: [] };
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
