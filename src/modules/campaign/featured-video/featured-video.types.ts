export type FeaturedVideoPlatform = 'Instagram' | 'TikTok';

export interface FeaturedVideoDto {
  id: string;
  source: 'submission' | 'manual';
  /** Set for submission rows, null for manual entries. */
  submissionId: string | null;
  /** Set for manual entries, null for submission rows. */
  manualEntryId: string | null;
  /** A manual entry may have no post URL. */
  postUrl: string | null;
  platform: FeaturedVideoPlatform;
  thumbnailUrl: string | null;
  /** Null until the post has a stored metrics snapshot. Manual entries always have a number. */
  views: number | null;
  likes: number | null;
  /** Already a percent, e.g. 4.2. */
  engagementRate: number | null;
  postedAt: Date | null;
  /** When the stats were captured (manual entries: last edited). Null when there are no stats yet. */
  statsCapturedAt: Date | null;
  featuredAt: Date;
  creator: { name: string | null; photoURL: string | null };
  videoUrl: string | null;
}

export interface FeaturedVideoState {
  id: string | null;
  submissionId: string | null;
  manualEntryId: string | null;
  postUrl: string | null;
  platform: FeaturedVideoPlatform | null;
  featured: boolean;
}
