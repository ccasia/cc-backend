import { toClientUpdate } from '../src/modules/campaign/overview/overview.updates';

describe('toClientUpdate', () => {
  it.each([
    ['Rinny sent the Agreement to Aisha Norizan', 'Agreements', 'Agreement sent to Aisha Norizan'],
    ['Agreement has been sent to Aisha Norizan', 'Agreements', 'Agreement sent to Aisha Norizan'],
    ['Aisha Norizan submitted the Agreement', 'Agreements', 'Aisha Norizan signed the agreement'],
    ['Super Admin approved the Agreement by Aisha Norizan', 'Agreements', 'Agreement with Aisha Norizan confirmed'],
    [
      'Admin "Rinny" approved pitch from Creator "Aisha Norizan" and sent to client',
      'Shortlist',
      'Aisha Norizan was proposed for your review',
    ],
    ['Client "Dion Yong" approved pitch from Creator "Aisha Norizan"', 'Shortlist', 'Aisha Norizan was approved'],
    ['Aisha Norizan has been shortlisted', 'Shortlist', 'Aisha Norizan was shortlisted'],
    [
      'Admin "Rinny" approved first draft video for creator "Aisha Norizan"',
      'Submissions',
      "Aisha Norizan's first draft video was approved",
    ],
    [
      'Draft approved by client "Dion Yong" from Creator "Aisha Norizan"',
      'Submissions',
      "Aisha Norizan's draft was approved",
    ],
    [
      'Changes requested on draft by client "Dion Yong" from Creator "Aisha Norizan"',
      'Submissions',
      "Changes requested on Aisha Norizan's draft",
    ],
    ["Rinny approved Aisha Norizan's submission Posting Link", 'Posting', "Aisha Norizan's post is live"],
    ['Rinny (Admin) submitted Posting Link for Aisha Norizan', 'Posting', 'Posting link submitted for Aisha Norizan'],
    ['Scheduled product delivery for Aisha Norizan', 'Logistics', 'Product delivery scheduled for Aisha Norizan'],
  ])('rewrites %s without staff or client user names', (raw, section, message) => {
    expect(toClientUpdate(raw)).toEqual({ section, message });
  });

  it.each([
    'Outreach status for Aisha Norizan',
    'Rinny changed UGC credits from 0 to 1 for Aisha Norizan',
    'Campaign Details edited - [Campaign Manager]',
    'Admin "Rinny" requested changes to first draft video for creator "Aisha Norizan"',
    'Changes requested on draft by admin "Rinny" from Creator "Aisha Norizan"',
    'Reimbursement RB-5GH7-1 for Aisha Norizan was approved',
    'Aisha Norizan has been removed from the campaign',
    '- has been shortlisted',
  ])('hides %s', (raw) => {
    expect(toClientUpdate(raw)).toBeNull();
  });
});
