// Utility to map timeline_type.name to submissionType.type
export function mapTimelineType(name: string): string {
  if (!name) return 'OTHER';
  const lower = name.toLowerCase();
  if (lower.includes('first draft')) return 'FIRST_DRAFT';
  if (lower.includes('agreement')) return 'AGREEMENT_FORM';
  if (lower.includes('final draft')) return 'FINAL_DRAFT';
  if (lower.includes('posting')) return 'POSTING';
  return 'OTHER';
}