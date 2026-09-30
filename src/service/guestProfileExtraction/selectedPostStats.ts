/**
 * Mean likes across the posts the engagement formula kept.
 *
 * Null when there is no sample. Used by the pitch modal when the creator has
 * no connected InstagramUser / TiktokUser row.
 */
export function averageLikesFromSelectedPosts(posts: unknown): number | null {
  if (!Array.isArray(posts) || posts.length === 0) return null;

  const likes = posts
    .map((post) => {
      if (!post || typeof post !== 'object') return NaN;
      const value = (post as { likes?: unknown }).likes;
      return typeof value === 'number' ? value : Number(value);
    })
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (!likes.length) return null;
  return likes.reduce((sum, value) => sum + value, 0) / likes.length;
}

type PendingExtraction = { status: string; createdAt: Date; topUpRunId: string | null } | null;

/**
 * What the loader needs to say where a running scrape is. The second-batch job
 * ID stays on the server; the browser only learns that one is running.
 */
export function extractionProgress(pending: PendingExtraction | undefined) {
  if (!pending) return null;
  return {
    status: pending.status,
    startedAt: pending.createdAt,
    checkingMore: Boolean(pending.topUpRunId),
  };
}

type LatestScrapeAudit = {
  formulaVersion?: string | null;
  extraction?: { selectedPosts?: unknown; formulaVersion?: string | null } | null;
};

/**
 * Lift scrape evidence off the latest metric audit onto the pitch payload.
 *
 * The audit include is an implementation detail of getPitchesV3. The modal
 * needs the posts and the formula, not the audit row.
 */
export function withScrapedEvidence<
  T extends { guestCreatorMetricAudits?: LatestScrapeAudit[]; pendingExtraction?: PendingExtraction },
>(pitch: T) {
  const { guestCreatorMetricAudits, pendingExtraction, ...rest } = pitch;
  const latest = guestCreatorMetricAudits?.[0];
  const selectedPosts = latest?.extraction?.selectedPosts;

  return {
    ...rest,
    scrapedAverageLikes: averageLikesFromSelectedPosts(selectedPosts),
    selectedPosts: Array.isArray(selectedPosts) ? selectedPosts : null,
    formulaVersion: latest?.formulaVersion ?? latest?.extraction?.formulaVersion ?? null,
    extractionProgress: extractionProgress(pendingExtraction),
  };
}
