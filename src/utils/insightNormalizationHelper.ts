import { NormalizedInsight } from '@services/trendAnalysisService';
import { BatchInsightResult } from '@services/socialMediaBatchService';

/**
 * Unified metric extraction helper
 * Handles both Instagram (array format) and TikTok (object format) API responses
 *
 * Instagram Response Format:
 * { metrics: [{ name: 'likes', value: 188 }, { name: 'views', value: 3362 }] }
 *
 * TikTok Response Format:
 * { metrics: { like_count: 52, view_count: 1014 } }
 */
export function getMetricValue(metrics: any, possibleKeys: string[]): number {
  if (!metrics) return 0;

  // Instagram format: Array of { name, value } objects
  if (Array.isArray(metrics)) {
    for (const key of possibleKeys) {
      const metric = metrics.find((m: any) => m.name === key);
      if (metric) {
        // Support direct value property (most common)
        if (typeof metric.value === 'number') {
          return metric.value;
        }
        // Support nested values array (alternative Instagram format)
        if (metric.values?.[0]?.value !== undefined) {
          return metric.values[0].value;
        }
      }
    }
  }

  // TikTok format: Object with key-value pairs
  for (const key of possibleKeys) {
    if (metrics[key] !== undefined && typeof metrics[key] === 'number') {
      return metrics[key];
    }
  }

  return 0;
}

/**
 * URL data structure for normalization
 */
export interface UrlData {
  postUrl: string;
  postingDate: Date | null;
  submission: {
    userId: string;
    user: {
      id: string;
      name: string | null;
    };
  };
}

/**
 * Normalize raw API results into consistent NormalizedInsight format
 * Used by backfill script, initial fetch service, and daily cronjob
 */
export function normalizeInsightResults(
  results: BatchInsightResult[],
  urls: UrlData[],
  platform: 'Instagram' | 'TikTok'
): NormalizedInsight[] {
  // Filter out errors
  const validResults = results.filter((r) => !r.error && r.insight);

  if (validResults.length === 0) {
    console.warn(`⚠️  No valid insights to normalize for ${platform}`);
    return [];
  }

  const normalizedInsights: NormalizedInsight[] = validResults.map((result) => {
    // Find matching URL data
    const url = urls.find((u) => u.submission.userId === result.userId);

    // Extract metrics using the unified helper
    const metrics = result.insight?.metrics;

    const views = getMetricValue(metrics, ['views', 'plays', 'view_count']);
    const likes = getMetricValue(metrics, ['likes', 'like_count']);
    const comments = getMetricValue(metrics, ['comments', 'comment_count']);
    const shares = getMetricValue(metrics, ['shares', 'share_count']);
    const saved = getMetricValue(metrics, ['saved']);
    const reach = getMetricValue(metrics, ['reach']);

    return {
      userId: result.userId,
      userName: url?.submission.user.name || 'Unknown',
      postUrl: url?.postUrl || '',
      postingDate: url?.postingDate || new Date(),
      views,
      likes,
      comments,
      shares,
      saved: platform === 'Instagram' ? saved : undefined,
      reach: platform === 'Instagram' ? reach : undefined,
    };
  });

  console.log(`📊 Normalized ${normalizedInsights.length} ${platform} insights`);

  return normalizedInsights;
}

/**
 * Debug helper to log metric extraction for troubleshooting
 */
export function debugLogMetrics(metrics: any, platform: string): void {
  console.log(`\n🐞 DEBUG: ${platform} metrics structure:`);
  console.dir(metrics, { depth: 4 });

  if (Array.isArray(metrics)) {
    console.log(`   Format: Array (Instagram-style)`);
    metrics.forEach((m: any) => {
      console.log(`   - ${m.name}: ${m.value ?? m.values?.[0]?.value ?? 'N/A'}`);
    });
  } else if (typeof metrics === 'object') {
    console.log(`   Format: Object (TikTok-style)`);
    Object.entries(metrics).forEach(([key, value]) => {
      console.log(`   - ${key}: ${value}`);
    });
  } else {
    console.log(`   Format: Unknown (${typeof metrics})`);
  }
}
