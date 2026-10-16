import { UpdateSection } from './overview.types';

interface UpdateRule {
  section: UpdateSection;
  pattern: RegExp;
  /** Rewrites the log line for clients: creator names only, never admin or client user names. */
  message: (m: RegExpMatchArray) => string;
}

const name = (raw: string) => raw.trim();

// CampaignLog is written for admins. Only these lines are shown to clients; anything else
// (credits, invoices, outreach, campaign edits, admin change requests, removals) is dropped.
export const CLIENT_UPDATE_RULES: UpdateRule[] = [
  // Shortlist
  {
    section: 'Shortlist',
    pattern: /^Admin ".*" approved pitch from Creator "(.+)" and sent to client$/,
    message: (m) => `${name(m[1])} was proposed for your review`,
  },
  {
    section: 'Shortlist',
    pattern: /^Client ".*" approved pitch from Creator "(.+)"$/,
    message: (m) => `${name(m[1])} was approved`,
  },
  {
    section: 'Shortlist',
    pattern: /^Client ".*" rejected pitch from Creator "(.+)"$/,
    message: (m) => `${name(m[1])} was declined`,
  },
  {
    section: 'Shortlist',
    pattern: /^Client ".*" set pitch from Creator "(.+)" to maybe$/,
    message: (m) => `${name(m[1])} was marked as maybe`,
  },
  {
    section: 'Shortlist',
    pattern: /^(.*\w.*) has been shortlisted$/,
    message: (m) => `${name(m[1])} was shortlisted`,
  },

  // Agreements
  {
    section: 'Agreements',
    pattern: /^Agreement has been sent to (.+)$/,
    message: (m) => `Agreement sent to ${name(m[1])}`,
  },
  {
    section: 'Agreements',
    pattern: /^.+ sent the Agreement to (.+)$/,
    message: (m) => `Agreement sent to ${name(m[1])}`,
  },
  {
    section: 'Agreements',
    pattern: /^(.+) submitted the Agreement$/,
    message: (m) => `${name(m[1])} signed the agreement`,
  },
  {
    section: 'Agreements',
    pattern: /^.+ approved the Agreement by (.+)$/,
    message: (m) => `Agreement with ${name(m[1])} confirmed`,
  },

  // Submissions
  {
    section: 'Submissions',
    pattern: /^(.+) submitted (First Draft|Final Draft)$/,
    message: (m) => `${name(m[1])} submitted their ${m[2].toLowerCase()}`,
  },
  {
    section: 'Submissions',
    pattern: /^Admin ".*" approved (first|final) draft (video|raw footage) for creator "(.+)"$/,
    message: (m) => `${name(m[3])}'s ${m[1]} draft ${m[2]} was approved`,
  },
  {
    section: 'Submissions',
    pattern: /^Draft approved by (?:admin|client) ".*" from Creator "(.+)"$/,
    message: (m) => `${name(m[1])}'s draft was approved`,
  },
  {
    section: 'Submissions',
    pattern: /^Changes requested on draft by client ".*" from Creator "(.+)"$/,
    message: (m) => `Changes requested on ${name(m[1])}'s draft`,
  },

  // Posting
  {
    section: 'Posting',
    pattern: /^.+ approved (.+?)'s (?:submission )?Posting Link$/,
    message: (m) => `${name(m[1])}'s post is live`,
  },
  {
    section: 'Posting',
    pattern: /^.+ \(Admin\) submitted Posting Link for (.+)$/,
    message: (m) => `Posting link submitted for ${name(m[1])}`,
  },
  {
    section: 'Posting',
    pattern: /^(.+) submitted Posting Link$/,
    message: (m) => `${name(m[1])} submitted a posting link`,
  },

  // Logistics (no shipped/delivered lines are logged today)
  {
    section: 'Logistics',
    pattern: /^Scheduled product delivery for (.+)$/,
    message: (m) => `Product delivery scheduled for ${name(m[1])}`,
  },
  {
    section: 'Logistics',
    pattern: /^Logistics assigned to (.+)$/,
    message: (m) => `Logistics assigned to ${name(m[1])}`,
  },
];

export const toClientUpdate = (message: string): { message: string; section: UpdateSection } | null => {
  for (const rule of CLIENT_UPDATE_RULES) {
    const match = message.match(rule.pattern);
    if (match) return { message: rule.message(match), section: rule.section };
  }
  return null;
};
