import {approvalOfDraft, creatorInvoice, creatorVerificationEmail, csmAdminInvoice, deliveryConfirmation, feedbackOnDraft, finalDraftDue, financeAdminInvoice, firstDraftDue, postingSchedule, shortlisted, trackingNumber} from "../cc-backend/src/config/nodemailer.config"

 shortlisted("novagaming991@gmail.com", "Design Better", "Afiq")
 firstDraftDue("novagaming991@gmail.com", "Design Better", "Afiq")
 feedbackOnDraft("novagaming991@gmail.com", "Design Better", "Afiq")
 finalDraftDue("novagaming991@gmail.com", "Design Better", "Afiq")
 approvalOfDraft("novagaming991@gmail.com", "Design Better", "Afiq")
 postingSchedule("novagaming991@gmail.com", "Design Better", "Afiq")
 trackingNumber("novagaming991@gmail.com", "Design Better", "Afiq", "12345678910")
 deliveryConfirmation("novagaming991@gmail.com", "Design Better", "Afiq")
 creatorInvoice("novagaming991@gmail.com", "Design Better", "Afiq")
 csmAdminInvoice("novagaming991@gmail.com", "Design Better", "Administrator")
 financeAdminInvoice("novagaming991@gmail.com", "Design Better", "Administrator")


console.log("Email Sent!")

// Design Better is a placeholder Campaign
// To execute code, run "npx ts-node tests.ts"