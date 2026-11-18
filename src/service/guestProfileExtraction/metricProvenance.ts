import type { MetricBaseline, MetricProvenance, MetricSource } from '@/src/types/guestProfileExtraction';

/**
 * Decide what provenance to record for a saved guest metric.
 *
 * Without a verified receipt a metric is manual or unavailable. It is never
 * automatic, whatever the browser claims. With a receipt, an edited value is
 * still a valid final value; it changes the source to `manual_override` and
 * keeps both the original and the final value for the audit.
 */

const NOT_SET = (value: string | number | null | undefined): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const changed = (
  before: MetricBaseline[keyof MetricBaseline],
  after: MetricBaseline[keyof MetricBaseline],
): boolean => {
  if (NOT_SET(before) && NOT_SET(after)) return false;
  return String(before ?? '') !== String(after ?? '');
};

export function classifyMetricProvenance(input: {
  receiptVerified: boolean;
  /** What the fetch produced. Null throughout when there was no fetch. */
  original: MetricBaseline;
  /** What the admin submitted. */
  final: MetricBaseline;
  /** Set when the admin confirmed a permitted manual fallback. */
  fallbackReason?: string | null;
  /** Threads carries Recent Views in the rate slot. No fetch ever fills it. */
  platform?: string | null;
}): MetricProvenance {
  const { receiptVerified, original, final, fallbackReason } = input;
  const isRecentViews = input.platform === 'threads';

  const editedFields = (['name', 'followerCount', 'engagementRate'] as const).filter((field) =>
    changed(original[field], final[field]),
  );

  let source: MetricSource;
  let overrideReason: string | null = null;

  if (receiptVerified) {
    // Only a metric change makes the saved value manual. A name edit is
    // recorded, but it does not change where the numbers came from.
    const metricEdited = editedFields.some((field) => field !== 'name');
    source = metricEdited ? 'manual_override' : 'automatic';
    // Typed Threads Recent Views is never a change to a fetched value.
    const fetchedEdits = editedFields.filter((field) => !(isRecentViews && field === 'engagementRate'));
    const reasons = [
      fetchedEdits.length > 0 ? `Admin edited ${fetchedEdits.join(', ')} after the fetch.` : null,
      isRecentViews && editedFields.includes('engagementRate') ? 'Threads recent views entered by hand.' : null,
    ].filter(Boolean);
    if (reasons.length > 0) overrideReason = reasons.join(' ');
    // Without a receipt the engagement rate decides the label. A blank rate
    // means there is no metric to describe, whatever else was entered.
  } else if (NOT_SET(final.engagementRate)) {
    source = 'unavailable';
    overrideReason = fallbackReason ? `No metric available: ${fallbackReason}.` : null;
  } else {
    source = 'manual_override';
    overrideReason = fallbackReason
      ? `Entered by hand after ${fallbackReason}.`
      : 'Entered by hand with no verified fetch.';
  }

  return { source, overrideReason, original, final };
}
