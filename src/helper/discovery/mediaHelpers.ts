export const mapInstagramApiTopVideos = (videos: any[]) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5)
    .map((media: any) => ({
      id: media.id,
      media_url: media.media_url,
      media_type: media.media_type,
      thumbnail_url: media.thumbnail_url,
      caption: media.caption,
      permalink: media.permalink,
      like_count: media.like_count,
      comments_count: media.comments_count,
      datePosted: media.timestamp ? new Date(media.timestamp) : null,
    }));

export const mapTikTokApiTopVideos = (videos: any[]) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.create_time ? Number(a.create_time) : 0;
      const bTime = b?.create_time ? Number(b.create_time) : 0;
      return bTime - aTime;
    })
    .slice(0, 5)
    .map((video: any) => ({
      video_id: video.id,
      cover_image_url: video.cover_image_url,
      title: video.title,
      embed_link: video.embed_link,
      like_count: video.like_count || 0,
      comment_count: video.comment_count || 0,
      share_count: video.share_count || 0,
      createdAt: video.create_time ? new Date(Number(video.create_time) * 1000) : null,
    }));

export const getLatestInstagramCaptionsForMatch = (videos: any[], limit = 5) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((video: any) => video?.caption || '');

export const getLatestTikTokTitlesForMatch = (videos: any[], limit = 5) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.create_time ? Number(a.create_time) : 0;
      const bTime = b?.create_time ? Number(b.create_time) : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((video: any) => video?.title || '');
