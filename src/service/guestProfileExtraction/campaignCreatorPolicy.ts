/**
 * `canManageCampaignCreators(userId, campaignId)`
 *
 * The one policy that guards every guest creator action: extraction start,
 * extraction status and receipt access, guest create, and guest update.
 *
 * It deliberately does NOT call `checkCampaignAccess`, which returns `next()`
 * for any admin with no `CampaignAdmin` lookup at all.
 *
 * It also checks `user.role` before it looks at `admin.mode`. A client that
 * happens to own an Admin record must never pass here.
 */

export type CampaignCreatorDenialCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_ADMIN'
  | 'CAMPAIGN_NOT_FOUND'
  | 'ROLE_NOT_ALLOWED'
  | 'NO_CAMPAIGN_ROLE'
  | 'VIEWER_ONLY';

export type CampaignCreatorPolicyResult =
  | { allowed: true; reason: 'superadmin' | 'campaignAdmin' }
  | { allowed: false; code: CampaignCreatorDenialCode; message: string };

/**
 * Internal admin roles that may manage campaign creators when they also hold a
 * qualifying `CampaignAdmin` row.
 *
 * Open product decision 1 in 06-decisions.md. Change this one constant.
 */
export const ALLOWED_INTERNAL_ADMIN_ROLES = ['csm', 'csl'] as const;

/** `CampaignAdmin.role` values that grant management. `viewer` never does. */
export const MANAGING_CAMPAIGN_ROLES = ['owner', 'editor', 'manager'] as const;

export interface PolicyStore {
  user: { findUnique(args: { where: any; include?: any; select?: any }): Promise<any | null> };
  campaign: { findUnique(args: { where: any; select?: any }): Promise<any | null> };
  campaignAdmin: { findUnique(args: { where: any }): Promise<any | null> };
}

const deny = (code: CampaignCreatorDenialCode, message: string): CampaignCreatorPolicyResult => ({
  allowed: false,
  code,
  message,
});

/** True for a real internal superadmin, by role first and mode second. */
export function isInternalSuperAdmin(user: { role?: string | null; admin?: { mode?: string | null } | null }): boolean {
  if (user.role === 'superadmin') return true;
  // `mode` alone is not enough. Only an admin account may use it.
  return user.role === 'admin' && ['god', 'advanced'].includes(user.admin?.mode ?? '');
}

function normalizeRoleName(user: { admin?: { role?: { name?: string | null } | null } | null }): string {
  return (user.admin?.role?.name ?? '').trim().toLowerCase();
}

function isAllowedInternalRole(roleName: string): boolean {
  if ((ALLOWED_INTERNAL_ADMIN_ROLES as readonly string[]).includes(roleName)) return true;
  // The repository names these roles inconsistently, so accept the long forms.
  return roleName.includes('customer success') || roleName.includes('cs lead');
}

export async function canManageCampaignCreators(
  userId: string | null | undefined,
  campaignId: string,
  store: PolicyStore,
): Promise<CampaignCreatorPolicyResult> {
  if (!userId) return deny('NOT_AUTHENTICATED', 'Sign in to continue.');

  const user = await store.user.findUnique({
    where: { id: userId },
    include: { admin: { include: { role: true } } },
  });

  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return deny('NOT_ADMIN', 'Only internal admins can manage campaign creators.');
  }

  const campaign = await store.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return deny('CAMPAIGN_NOT_FOUND', 'Campaign not found.');

  if (isInternalSuperAdmin(user)) {
    return { allowed: true, reason: 'superadmin' };
  }

  if (!isAllowedInternalRole(normalizeRoleName(user))) {
    return deny('ROLE_NOT_ALLOWED', 'Your admin role cannot manage campaign creators.');
  }

  const membership = await store.campaignAdmin.findUnique({
    where: { adminId_campaignId: { adminId: userId, campaignId } },
  });

  if (!membership) {
    return deny('NO_CAMPAIGN_ROLE', 'You are not assigned to this campaign.');
  }
  if (!(MANAGING_CAMPAIGN_ROLES as readonly string[]).includes(membership.role)) {
    return deny('VIEWER_ONLY', 'Your access to this campaign is view only.');
  }

  return { allowed: true, reason: 'campaignAdmin' };
}
