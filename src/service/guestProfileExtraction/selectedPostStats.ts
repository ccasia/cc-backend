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
