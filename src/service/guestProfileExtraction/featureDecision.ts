/**
 * One server-side decision for the whole feature.
 *
 * Both automatic extraction and the current manual component read this. The
 * browser is told the answer; it never decides for itself.
 */

export interface FeatureDecision {
  enabled: boolean;
  reason: 'disabled' | 'allowlisted' | 'superadmin_canary' | 'not_allowlisted' | 'enabled';
}

export interface FeatureDecisionInput {
  userId: string;
  isSuperAdmin: boolean;
}

export interface FeatureFlags {
  /** Master switch. Off in production until every release gate passes. */
  enabled: boolean;
  /** Explicit user IDs. Empty means "no allowlist restriction". */
  allowlist: string[];
  /** Canary: superadmins only, whatever the allowlist says. */
  superAdminsOnly: boolean;
}

export function loadFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return {
    enabled: (env.GUEST_PROFILE_METRICS_ENABLED ?? 'false').toLowerCase() === 'true',
    allowlist: (env.GUEST_PROFILE_METRICS_ADMIN_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    superAdminsOnly: (env.GUEST_PROFILE_METRICS_SUPERADMINS_ONLY ?? 'false').toLowerCase() === 'true',
  };
}

export function decideGuestProfileMetrics(input: FeatureDecisionInput, flags: FeatureFlags): FeatureDecision {
  if (!flags.enabled) return { enabled: false, reason: 'disabled' };

  if (flags.allowlist.length > 0) {
    return flags.allowlist.includes(input.userId)
      ? { enabled: true, reason: 'allowlisted' }
      : { enabled: false, reason: 'not_allowlisted' };
  }

  if (flags.superAdminsOnly) {
    return input.isSuperAdmin
      ? { enabled: true, reason: 'superadmin_canary' }
      : { enabled: false, reason: 'not_allowlisted' };
  }

  return { enabled: true, reason: 'enabled' };
}
