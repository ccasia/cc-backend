// src/types/index.ts

// ── Section identifiers ───────────────────────────────────────────────────────

export type ReportSection =
  | 'campaign_summary'
  | 'engagement_interactions'
  | 'views_analysis'
  | 'audience_sentiment'
  | 'top_creator_personas'
  | 'campaign_recommendations';

export const ALL_SECTIONS: ReportSection[] = [
  'campaign_summary',
  'engagement_interactions',
  'views_analysis',
  'audience_sentiment',
  'top_creator_personas',
  'campaign_recommendations',
];

// ── External metrics shape ────────────────────────────────────────────────────
// Passed in the API request body alongside campaignId.
// All fields optional — the system uses DB data as fallback when not provided.

export interface ExternalMetrics {
  // Section 1 — Campaign Summary
  summary?: {
    totalViews?: number; // from TikTok/Instagram
    totalEngagements?: number;
    engagementRate?: number; // %
    roas?: number; // Return on Ad Spend %
    reach?: number;
    impressions?: number;
  };

  // Section 2 — Engagement & Interactions
  engagement?: {
    totalEngagement?: number;
    peakWeek?: string; // "Week 3"
    peakEngagement?: number;
    weeklyEngagement?: { week: string; engagement: number; views: number }[];
    platformBreakdown?: { platform: string; posts: number; engagement: number }[];
    creatorMetrics?: {
      userId: string; // matched to your DB userId
      platform: string;
      engagementRate: number;
      followers: number;
      views: number;
      likes: number;
      comments: number;
    }[];
  };

  // Section 3 — Views
  views?: {
    totalViews?: number;
    weeklyViews?: { week: string; views: number }[];
    peakWeek?: string;
    peakViews?: number;
  };

  // Section 4 — Sentiment
  // (Sentiment usually comes from feedback in DB — external override available)
  sentiment?: {
    positiveRate?: number;
    neutralRate?: number;
    negativeRate?: number;
    sampleComments?: { content: string; sentiment: string }[];
  };

  // Section 5 — Creator Personas (per-creator override)
  creators?: {
    userId: string;
    totalViews?: number;
    totalLikes?: number;
    totalComments?: number;
    engagementRate?: number;
    followers?: number;
  }[];
}

// ── Request ───────────────────────────────────────────────────────────────────

export interface GenerateReportRequest {
  campaignId: string;
  sections?: ReportSection[]; // omit = all sections
  externalMetrics?: ExternalMetrics; // API data passed from your frontend/backend
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface SectionResult {
  section: ReportSection;
  summary: string; // Gemini prose — bold stats inline
  data: Record<string, unknown>; // merged DB + external data (for charts)
}

export interface CampaignReportResult {
  campaignId: string;
  campaignName: string;
  geminiModel: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  sections: SectionResult[];
  durationMs: number;
  createdAt: Date;
}
