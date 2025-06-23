export class UrlParser {
  static extractInstagramShortcode(url: string): string | null {
    const regex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  static extractTikTokVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // Handle different TikTok URL formats
      if (urlObj.hostname.includes('tiktok.com')) {
        // Format: https://www.tiktok.com/@username/video/1234567890
        if (urlObj.pathname.includes('/video/')) {
          const videoId = urlObj.pathname.split('/video/')[1].split('?')[0];
          return videoId;
        }

        // Format: https://www.tiktok.com/@username/photo/1234567890 (for photo posts)
        if (urlObj.pathname.includes('/photo/')) {
          const photoId = urlObj.pathname.split('/photo/')[1].split('?')[0];
          return photoId;
        }

        // Handle short URLs like vm.tiktok.com
        if (urlObj.hostname.includes('vm.tiktok.com')) {
          const shortCode = urlObj.pathname.substring(1); // Remove leading slash
          return shortCode;
        }

        // Handle mobile URLs like m.tiktok.com
        if (urlObj.hostname.includes('m.tiktok.com')) {
          if (urlObj.pathname.includes('/v/')) {
            const videoId = urlObj.pathname.split('/v/')[1].split('.html')[0];
            return videoId;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Invalid TikTok URL:', error);
      return null;
    }
  }
}