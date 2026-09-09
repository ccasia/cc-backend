import { canManageCampaignCreators, isInternalSuperAdmin, type PolicyStore } from './campaignCreatorPolicy';
import { decideGuestProfileMetrics, type FeatureDecision, type FeatureFlags } from './featureDecision';

/**
 * The four gates every guest profile action passes, in one place.
 *
 * Order matters. The feature decision comes first, so a disabled feature never
 * reveals whether a campaign exists or who manages it. A disabled decision
 * also means no extraction can start, which is what rollback relies on.
 */

export type GuestActionDenialReason = 'NOT_AUTHENTICATED' | 'FEATURE_DISABLED' | 'NOT_PERMITTED';

export type AuthorizeResult =
  | { allowed: true; userId: string; decision: FeatureDecision }
  | {
      allowed: false;
      reason: GuestActionDenialReason;
      status: 401 | 403 | 404;
      message: string;
      code?: string;
      decision?: FeatureDecision;
    };

export async function authorizeGuestProfileAction(
  input: { userId: string | null | undefined; campaignId: string },
  deps: { store: PolicyStore; flags: FeatureFlags },
): Promise<AuthorizeResult> {
  const { userId, campaignId } = input;

  if (!userId) {
    return { allowed: false, reason: 'NOT_AUTHENTICATED', status: 401, message: 'Sign in to continue.' };
  }

  const user = await deps.store.user.findUnique({
    where: { id: userId },
    include: { admin: { include: { role: true } } },
  });

  const decision = decideGuestProfileMetrics(
    { userId, isSuperAdmin: user ? isInternalSuperAdmin(user) : false },
    deps.flags,
  );

  if (!decision.enabled) {
    // 404, not 403. A feature that is off should look absent.
    return {
      allowed: false,
      reason: 'FEATURE_DISABLED',
      status: 404,
      message: 'This feature is not available.',
      decision,
    };
  }

  const policy = await canManageCampaignCreators(userId, campaignId, deps.store);
  if (!policy.allowed) {
    return {
      allowed: false,
      reason: 'NOT_PERMITTED',
      status: policy.code === 'CAMPAIGN_NOT_FOUND' ? 404 : 403,
      message: policy.message,
      code: policy.code,
      decision,
    };
  }

  return { allowed: true, userId, decision };
}
