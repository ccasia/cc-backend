export const notifications = {
  level1: {
    notUrgent: [
      {
        key: 'invoiceGeneration',
        message: 'Your invoice will be generated within the next 24 hours of work done.',
      },
      {
        key: 'logisticsBarProgress',
        message: "Check the logistics bar for the latest updates on your project's progress!",
      },
      {
        key: 'approvedPitches',
        message: 'Congratulations! Your pitch has been approved. We’re excited to move forward.',
      },
      {
        key: 'rejectedPitches',
        message: "Unfortunately, your pitch was not approved this time. Please review and resubmit if you'd like.",
      },
    ],
  },
  level2: {
    medium: [
      {
        key: 'signAgreementReminder',
        message: 'Just a reminder to sign the agreement to proceed with the next steps. Thank you!',
      },
      {
        key: 'dueDates',
        message: (task: string, dueDate: string, campaignName: string): string =>
          `Reminder: Your ${task} for campaign ${campaignName} is due on ${dueDate}. Please ensure it’s completed by then.`,
      },
      {
        key: 'reShootRequired',
        message:
          'A re-shoot is required. Please make the necessary adjustments and resubmit at your earliest convenience.',
      },
      {
        key: 'feedbackFirstDraft',
        message: 'Here’s the feedback for your 1st draft. Please review and make the necessary revisions.',
      },
      {
        key: 'feedbackFinalDraft',
        message: 'Feedback for your final draft has been provided. Please review and make any final adjustments.',
      },
      {
        key: 'trackingNumber',
        message: 'Your tracking number is [tracking number]. Use it to track your shipment.',
      },
    ],
  },
  level3: {
    urgent: [
      {
        key: 'paymentReceived',
        message: 'Payment has been received. Thank you for your work!',
      },
      {
        key: 'uploadFinalDraftReminder',
        message: 'Reminder: Please upload your final draft by [due date].',
      },
      {
        key: 'uploadFirstDraftReminder',
        message: 'Reminder: Please upload your 1st draft by [due date].',
      },
      {
        key: 'approvalDrafts',
        message: 'Your draft has been approved! Great work!',
      },
      {
        key: 'confirmationOfDelivery',
        message: 'Please click to confirm receipt of the delivery.',
      },
      {
        key: 'productDelivered',
        message: 'The product has been delivered. Check your shipment status for details.',
      },
      {
        key: 'postReminder',
        message: 'Reminder to post about your project! Don’t forget to share the news.',
      },
    ],
  },
};
