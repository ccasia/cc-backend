interface CurrentFinalDraftMediaCounts {
  videos: number;
  rawFootages: number;
  photos: number;
}

interface FinalDraftRequirements {
  rawFootage?: boolean | null;
  photos?: boolean | null;
}

interface DraftVideoLike {
  id: string;
  url: string | null;
  resubmittedFromId?: string | null;
  previousDrafts?: string[] | null;
  createdAt?: Date | string | null;
}

export const hasRequiredCurrentFinalDraftMedia = (
  mediaCounts: CurrentFinalDraftMediaCounts,
  requirements: FinalDraftRequirements,
) => {
  const hasVideos = mediaCounts.videos > 0;
  const hasRawFootage = requirements.rawFootage ? mediaCounts.rawFootages > 0 : true;
  const hasPhotos = requirements.photos ? mediaCounts.photos > 0 : true;

  return {
    hasVideos,
    hasRawFootage,
    hasPhotos,
    allDeliverablesSent: hasVideos && hasRawFootage && hasPhotos,
  };
};

export const hasCurrentFinalDraftRevisionRequest = (
  revisionCounts: CurrentFinalDraftMediaCounts,
  requirements: FinalDraftRequirements,
) => {
  const hasVideoRevision = revisionCounts.videos > 0;
  const hasRawFootageRevision = requirements.rawFootage ? revisionCounts.rawFootages > 0 : false;
  const hasPhotoRevision = requirements.photos ? revisionCounts.photos > 0 : false;

  return hasVideoRevision || hasRawFootageRevision || hasPhotoRevision;
};

const createdAtTime = (value?: Date | string | null): number => {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const getCurrentDraftVideos = <T extends DraftVideoLike>(videos: T[]): T[] => {
  const replacedVideoIds = new Set(videos.map((video) => video.resubmittedFromId).filter(Boolean));

  return videos
    .filter((video) => !replacedVideoIds.has(video.id))
    .sort((a, b) => createdAtTime(b.createdAt) - createdAtTime(a.createdAt));
};

export const pairUploadedDraftsWithRevisionRequests = <T extends { id: string }>(
  requestedVideos: T[],
  uploadedUrls: string[],
) =>
  requestedVideos.slice(0, uploadedUrls.length).map((requested, index) => ({
    requested,
    url: uploadedUrls[index],
  }));

const appendUniqueUrl = (urls: string[], url?: string | null) => {
  if (url && !urls.includes(url)) urls.push(url);
};

const appendUniqueUrls = (urls: string[], nextUrls?: string[] | null) => {
  nextUrls?.forEach((url) => appendUniqueUrl(urls, url));
};

export const previousDraftUrlsForReplacement = <T extends DraftVideoLike>(requestedVideo: T): string[] => {
  const previousDrafts: string[] = [];

  appendUniqueUrls(previousDrafts, requestedVideo.previousDrafts);
  appendUniqueUrl(previousDrafts, requestedVideo.url);

  return previousDrafts;
};

export const normalizeVideoDraftHistory = <T extends DraftVideoLike>(videos: T[]) => {
  const byId = new Map(videos.map((video) => [video.id, video]));
  const currentVideoIds = new Set(getCurrentDraftVideos(videos).map((video) => video.id));

  return [...videos]
    .sort((a, b) => createdAtTime(b.createdAt) - createdAtTime(a.createdAt))
    .map((video) => {
      const previousDrafts: string[] = [];
      const previousDraftIds: string[] = [];
      let cursor = video;
      const visited = new Set<string>();
      const chain: T[] = [];

      while (cursor.resubmittedFromId && !visited.has(cursor.resubmittedFromId)) {
        visited.add(cursor.resubmittedFromId);
        const parent = byId.get(cursor.resubmittedFromId);
        if (!parent) break;
        chain.unshift(parent);
        cursor = parent;
      }

      chain.forEach((parent) => {
        previousDraftIds.push(parent.id);
        appendUniqueUrls(previousDrafts, parent.previousDrafts);
        appendUniqueUrl(previousDrafts, parent.url);
      });

      const persistedPreviousDrafts = (video.previousDrafts ?? []).filter(Boolean);

      return {
        ...video,
        isCurrentDraft: currentVideoIds.has(video.id),
        previousDraftIds,
        previousDrafts: persistedPreviousDrafts.length ? persistedPreviousDrafts : previousDrafts,
      };
    });
};
