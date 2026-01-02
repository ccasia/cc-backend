import axios from 'axios';

export interface ExtractedUrlData {
  platform: 'Instagram' | 'TikTok' | null;
  type: 'post' | 'reel' | 'video' | 'story' | 'profile' | 'unknown';
  postUrl: string; // Normalized URL
  shortCode?: string; // Instagram shortcode
  mediaId?: string; // Instagram media ID or TikTok video ID
  username?: string; // TikTok username
  isValid: boolean;
  reason?: string; // Why it's invalid
}

/**
 * Extract and validate social media URLs
 * Supports Instagram posts/reels and TikTok videos
 */
export async function extractAndValidateUrl(rawUrl: string): Promise<ExtractedUrlData> {
  try {
    // 1. Normalize URL (trim, add protocol, remove fragments)
    const normalizedUrl = normalizeUrl(rawUrl);

    // 2. Detect platform
    const platform = detectPlatform(normalizedUrl);
    if (!platform) {
      return {
        platform: null,
        type: 'unknown',
        postUrl: rawUrl,
        isValid: false,
        reason: 'Unknown platform (not Instagram or TikTok)',
      };
    }

    if (platform === 'Instagram') {
      return extractInstagramData(normalizedUrl);
    } else if (platform === 'TikTok') {
      // TikTok short links require async resolution
      return await extractTikTokData(normalizedUrl);
    }

    return {
      platform: null,
      type: 'unknown',
      postUrl: rawUrl,
      isValid: false,
      reason: 'Unsupported platform',
    };
  } catch (error: any) {
    return {
      platform: null,
      type: 'unknown',
      postUrl: rawUrl,
      isValid: false,
      reason: `Extraction failed: ${error.message}`,
    };
  }
}

/**
 * Normalize URL by adding protocol and removing tracking params
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();

  // Add protocol if missing
  if (!normalized.startsWith('http')) {
    normalized = `https://${normalized}`;
  }

  try {
    const urlObj = new URL(normalized);
    // Remove tracking params and fragments
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString();
  } catch {
    // If URL parsing fails, return as-is
    return normalized;
  }
}

/**
 * Detect platform from URL
 */
function detectPlatform(url: string): 'Instagram' | 'TikTok' | null {
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  return null;
}

/**
 * Extract Instagram post/reel data
 */
function extractInstagramData(url: string): ExtractedUrlData {
  // Instagram shortcode regex: /p/ABC123xyz or /reel/ABC123xyz
  const postMatch = url.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);

  if (!postMatch) {
    // Check if it's a story or profile link (invalid)
    if (url.includes('/stories/')) {
      return {
        platform: 'Instagram',
        type: 'story',
        postUrl: url,
        isValid: false,
        reason: 'Stories are not supported (temporary content)',
      };
    }

    if (url.match(/instagram\.com\/[^\/]+\/?$/)) {
      return {
        platform: 'Instagram',
        type: 'profile',
        postUrl: url,
        isValid: false,
        reason: 'Profile links are not supported (need post/reel URL)',
      };
    }

    return {
      platform: 'Instagram',
      type: 'unknown',
      postUrl: url,
      isValid: false,
      reason: 'Could not extract post/reel ID from URL',
    };
  }

  const shortCode = postMatch[1];
  const isReel = url.includes('/reel/');

  return {
    platform: 'Instagram',
    type: isReel ? 'reel' : 'post',
    postUrl: url,
    shortCode,
    isValid: true,
  };
}

/**
 * Extract TikTok video data
 * Handles short links (vm.tiktok.com, vt.tiktok.com) by following redirects
 */
async function extractTikTokData(url: string): Promise<ExtractedUrlData> {
  // TikTok video ID regex: /video/1234567890
  const videoMatch = url.match(/\/video\/(\d+)/);

  if (videoMatch) {
    const mediaId = videoMatch[1];

    // Extract username if present: /@username/video/ID
    const usernameMatch = url.match(/\/@([a-zA-Z0-9_.]+)\/video\/\d+/);
    const username = usernameMatch?.[1];

    return {
      platform: 'TikTok',
      type: 'video',
      postUrl: url,
      mediaId,
      username,
      isValid: true,
    };
  }

  // Check for short links (vm.tiktok.com, vt.tiktok.com)
  if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
    try {
      console.log(`🔄 Resolving TikTok short URL: ${url}`);
      const resolved = await resolveShortUrl(url);
      console.log(`✅ Resolved to: ${resolved}`);

      const videoMatch = resolved.match(/\/video\/(\d+)/);
      if (videoMatch) {
        const mediaId = videoMatch[1];
        const usernameMatch = resolved.match(/\/@([a-zA-Z0-9_.]+)\/video\/\d+/);
        const username = usernameMatch?.[1];

        return {
          platform: 'TikTok',
          type: 'video',
          postUrl: resolved, // Use resolved URL
          mediaId,
          username,
          isValid: true,
        };
      }
    } catch (error: any) {
      console.warn(`⚠️  Could not resolve short URL: ${error.message}, using as-is`);
      
      // Fallback: Store the short URL itself as valid - it can be resolved later by TikTok API
      // Extract short code from URL (e.g., ZS5NQoDLq from https://vt.tiktok.com/ZS5NQoDLq/)
      const shortCodeMatch = url.match(/(?:vm|vt)\.tiktok\.com\/([A-Za-z0-9]+)/);
      const shortCode = shortCodeMatch?.[1];

      if (shortCode) {
        return {
          platform: 'TikTok',
          type: 'video',
          postUrl: url, // Store original short URL
          shortCode: shortCode, // Store short code for later resolution
          isValid: true, // Consider valid even if we couldn't resolve it
          reason: 'Short URL stored for later API resolution',
        };
      }

      return {
        platform: 'TikTok',
        type: 'unknown',
        postUrl: url,
        isValid: false,
        reason: `Could not resolve short URL and no short code found: ${error.message}`,
      };
    }
  }

  // Check if it's a profile link (invalid)
  if (url.match(/tiktok\.com\/@[^\/]+\/?$/)) {
    return {
      platform: 'TikTok',
      type: 'profile',
      postUrl: url,
      isValid: false,
      reason: 'Profile links are not supported (need video URL)',
    };
  }

  return {
    platform: 'TikTok',
    type: 'unknown',
    postUrl: url,
    isValid: false,
    reason: 'Could not extract video ID from URL',
  };
}

/**
 * Follow URL redirect to get actual URL
 * Used for TikTok short links (vm.tiktok.com, vt.tiktok.com)
 */
async function resolveShortUrl(url: string): Promise<string> {
  try {
    const response = await axios.head(url, {
      maxRedirects: 5,
      timeout: 5000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Get final URL after redirects
    const resolvedUrl = response.request?.res?.responseUrl || response.config.url || url;
    return resolvedUrl;
  } catch (error: any) {
    // If HEAD fails, try GET with minimal data
    if (error.response?.status === 405) {
      const response = await axios.get(url, {
        maxRedirects: 5,
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 400,
      });
      return response.request?.res?.responseUrl || response.config.url || url;
    }
    throw error;
  }
}

/**
 * Retry wrapper with transient error detection
 */
export async function extractWithRetry(
  url: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<ExtractedUrlData> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await extractAndValidateUrl(url);
    } catch (error: any) {
      lastError = error;

      // Check if error is transient (network issues, rate limits)
      const isTransient =
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.response?.status === 429 ||
        (error.response?.status >= 500 && error.response?.status < 600);

      if (isTransient && attempt < maxRetries) {
        console.log(`🔄 Retry ${attempt}/${maxRetries} for ${url} (transient error)`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }

      // Non-transient error or max retries reached
      break;
    }
  }

  // Failed after all retries
  return {
    platform: null,
    type: 'unknown',
    postUrl: url,
    isValid: false,
    reason: `Extraction failed after ${maxRetries} attempts: ${lastError?.message}`,
  };
}
