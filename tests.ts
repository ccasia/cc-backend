import {
  approvalOfDraft,
  creatorInvoice,
  creatorVerificationEmail,
  csmAdminInvoice,
  deliveryConfirmation,
  feedbackOnDraft,
  finalDraftDue,
  financeAdminInvoice,
  firstDraftDue,
  postingSchedule,
  shortlisted,
  trackingNumber,
} from '../cc-backend/src/config/nodemailer.config';

shortlisted('email@gmail.com', 'Design Better', 'Afiq');
// firstDraftDue("email@gmail.com", "Design Better", "Afiq")
// feedbackOnDraft("email@gmail.com", "Design Better", "Afiq")
// finalDraftDue("email@gmail.com", "Design Better", "Afiq")
// approvalOfDraft("email@gmail.com", "Design Better", "Afiq")
// postingSchedule("email@gmail.com", "Design Better", "Afiq")
// trackingNumber("email@gmail.com", "Design Better", "Afiq", "12345678910")
// deliveryConfirmation("email@gmail.com", "Design Better", "Afiq")
// creatorInvoice("email@gmail.com", "Design Better", "Afiq")
// csmAdminInvoice("email@gmail.com", "Design Better", "Administrator")
// financeAdminInvoice("novagaming991@gmail.com", "Design Better", "Administrator")

console.log('Email Sent!');

// Design Better is a placeholder Campaign
// Uncomment to test
// To execute code, run "npx ts-node tests.ts"
