/**
 * Campaign flow utilities — single source of truth for "does this campaign have a client"
 * and which approval flow (CLIENT vs ADMIN) a campaign should follow.
 *
 * Clients are attached to campaigns in two parallel models (both written on attach):
 * - CampaignClient rows (client <-> campaign)
 * - CampaignAdmin rows whose admin is a client user
 *
 * Client detection matches campaignController's manager-update path:
 * `admin.user.role === 'client' || admin.role?.name === 'Client'`.
 *
 * See docs/v4-unification-plan.md (cc-frontend) for the full context.
 */

type CampaignAdminLike = {
  admin?: {
    user?: { role?: string | null } | null;
    role?: { name?: string | null } | null;
  } | null;
};

type CampaignFlowInput = {
  campaignAdmin?: CampaignAdminLike[] | null;
};

const isClientAdmin = (ca: CampaignAdminLike): boolean =>
  ca?.admin?.user?.role === 'client' || ca?.admin?.role?.name === 'Client';

/**
 * Whether the campaign has any client attached.
 *
 * The sole signal is a client-role user among the campaign admins — CampaignClient rows
 * are deliberately NOT counted: their cleanup on client removal is best-effort (errors
 * swallowed), and a stale row must never flip an in-flight campaign into the client flow.
 *
 * Requires the campaign object to include `campaignAdmin -> admin -> { user, role }`.
 * Callers that only loaded a bare campaign row must include that relation before calling.
 */
export const campaignHasClient = (campaign: CampaignFlowInput): boolean =>
  campaign.campaignAdmin?.some(isClientAdmin) ?? false;

/**
 * Effective campaign origin for approval flows.
 *
 * Client presence is the ONLY signal: campaigns with client managers follow the CLIENT
 * flow (admin approval forwards to the client) regardless of `origin`; campaigns without
 * any follow the ADMIN flow (admin approval is final). `origin` is deliberately not a
 * fallback — CLIENT-origin campaigns can exist without any client user attached (e.g.
 * BD-brief invitations where the client filled a form via magic token and was never
 * provisioned), and routing their approvals to a client that doesn't exist strands them.
 * Every legitimately client-managed campaign attaches client users to campaignAdmin at
 * creation (see clientController) or via the campaign-manager editors.
 */
export const getEffectiveCampaignOrigin = (campaign: CampaignFlowInput): 'CLIENT' | 'ADMIN' =>
  campaignHasClient(campaign) ? 'CLIENT' : 'ADMIN';
