// Role detection helpers for the Campaign Brief flow.
//
// Mirrors the role classification used by `isBdOrSuperadmin` in
// `src/middleware/onlySuperadmin.ts`. Centralized here so the listing
// controller and any future brief endpoints share one source of truth.

type UserWithAdmin = {
  role?: string | null;
  admin?: {
    mode?: string | null;
    role?: { name?: string | null } | null;
  } | null;
} | null;

export type BriefRole = 'superadmin' | 'BD' | 'CSL' | 'CS' | 'other';

export const isSuperadminUser = (user: UserWithAdmin): boolean => {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const mode = user.admin?.mode || '';
  return ['god', 'advanced'].includes(mode);
};

export const isBDUser = (user: UserWithAdmin): boolean => {
  const name = (user?.admin?.role?.name || '').toLowerCase();
  return (
    name === 'bd' ||
    name.includes('business development') ||
    name === 'sales and marketing' ||
    name.includes('sales and marketing')
  );
};

// CS Lead — oversees handovers; can view/activate all handed-over briefs by
// role (not by campaignAdmin membership).
export const isCSLUser = (user: UserWithAdmin): boolean => {
  const name = (user?.admin?.role?.name || '').toLowerCase();
  return name === 'csl' || name.includes('cs lead');
};

// CS Manager — only sees the specific briefs they've been assigned to (i.e.
// where they're a campaignAdmin).
export const isCSUser = (user: UserWithAdmin): boolean => {
  const name = (user?.admin?.role?.name || '').toLowerCase();
  return name === 'csm' || name.includes('customer success');
};

export const classifyBriefRole = (user: UserWithAdmin): BriefRole => {
  if (isSuperadminUser(user)) return 'superadmin';
  if (isBDUser(user)) return 'BD';
  if (isCSLUser(user)) return 'CSL';
  if (isCSUser(user)) return 'CS';
  return 'other';
};
