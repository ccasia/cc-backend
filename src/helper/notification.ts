interface Entity {
  campaignId?: string;
  submissionId?: string;
}

const notificationCampaignLive = (campaignName: string) => {
  return {
    title: '✨ New campaign just dropped',
    message: `[${campaignName}] is live in Discovery`,
  };
};

const notificationAdminAssign = (campaignName: string) => {
  return {
    title: '🚀 New Campaign Assigned',
    message: `You have been assigned to Campaign ${campaignName}!`,
  };
};

const notificationMaintenance = (campaignName: string) => {
  return {
    title: '⚙️ Campaign under Maintenance',
    message: `Campaign ${campaignName}  is currently down for maintenance.`,
  };
};

const notificationPitch = (campaignName: string, type: 'Admin' | 'Creator', creatorName?: string) => {
  if (type === 'Admin') {
    return {
      title: '📬 New Pitch Submitted!',
      message: `A new pitch for the ${campaignName} has been submitted by ${creatorName}.`,
    };
  }
  return {
    title: '📤 Pitch Sent Successfully!',
    message: `Your pitch for the ${campaignName} has been sent. We’ll review it and get back to you soon. Thanks for your submission!`,
  };
};

//  Feedback on Draft

const notificationDraft = (campaignName: string, type: 'Admin' | 'Creator', creatorName?: string, draft?: string) => {
  if (type === 'Admin') {
    return {
      title: `📬 New Draft Received!`,
      message: `A new draft for the ${campaignName} has been submitted by ${creatorName}.`,
    };
  }
  return {
    title: '📝 Draft Sent Successfully!',
    message: `Your draft for the ${campaignName} has been sent. We’ll review it and let you know if any changes are needed`,
  };
};

const notificationSignature = (campaignName: string, entity?: Entity) => {
  return {
    title: `🎉 You're in for ${campaignName}`,
    message: 'Sign your agreement to lock it in.',
    campaignId: entity?.campaignId,
    submissionId: entity?.submissionId,
  };
};

//
const notificationPendingAgreement = (campaignName: string) => {
  return {
    title: '📝 Shortlisted Creators Pending Agreement Generation',
    message: ` Shortlisted Creators Pending! Shortlisted creators are pending agreement generation for ${campaignName}.`,
  };
};

const notificationAgreement = (campaignName: string, type: 'Admin' | 'Creator', creatorName?: string) => {
  if (type === 'Admin') {
    return {
      title: '📄 New Agreement Received!',
      message: `An agreement for the ${campaignName} has been submitted by ${creatorName}. `,
    };
  }
  return {
    title: '🤝 Agreement Sent! ',
    message: `Your agreement for the ${campaignName} has been sent.`,
  };
};

const notificationApproveAgreement = (campaignName: string) => {
  return {
    title: '🚀Agreement approved',
    message: `Start your draft for ${campaignName}`,
  };
};

const notificationApproveDraft = (campaignName: string, draft: string) => {
  return {
    title: `✅ Draft Approved!`,
    message: `Your ${draft} for ${campaignName} has been approved. Great work!`,
  };
};

const notificationRejectDraft = (campaignName: string, draft: string) => {
  return {
    title: `❌ ${draft} Rejected`,
    message: `Your ${draft} for the ${campaignName} has been rejected. Please review the feedback and revise your submission.`,
  };
};

const notificationPosting = (campaignName: string, type: 'Admin' | 'Creator', creatorName?: string) => {
  if (type === 'Admin') {
    return {
      title: '🎉 Post Submitted!',
      message: `${creatorName} has successfully posted for the ${campaignName}. `,
    };
  }
  return {
    title: '🎉 Post Submitted!',
    message: `Your post for the ${campaignName} has been successfully submitted. Thank you for your work!`,
  };
};

const notificationGroupChat = (campaignName: string, thread: string) => {
  return {
    title: `💬 New Message in ${thread} Chat!`,
    message: `You have a new message in your group chat for ${campaignName} `,
  };
};

const notificationCSMChat = (csName: string, messageContent: string) => {
  return {
    title: `💬 ${csName} messaged you`,
    message: messageContent?.trim() ? messageContent : 'Sent you an attachment',
  };
};

const notificationLogisticDelivery = (campaignName: string) => {
  return {
    title: '📦 Logistics Delivered! ',
    message: ` Your logistics for ${campaignName} have been delivered.`,
  };
};

const notificationLogisticTracking = (campaignName: string, trackingNumber: string) => {
  return {
    title: ' 📦 Logistics Submitted! ',
    message: `Your logistics for ${campaignName} have been submitted, with tracking number ${trackingNumber}`,
  };
};

const notificationLogisticShipped = (campaignName: string, trackingLink?: string | null) => {
  return {
    title: '📦 Product Shipped!',
    message: trackingLink
      ? `Your product for ${campaignName} is on the way. Track it here: ${trackingLink}`
      : `Your product for ${campaignName} is on the way.`,
  };
};

const notificationInvoiceGenerate = (campaignName: string) => {
  return {
    title: `💰 Invoice Generated!`,
    message: `An invoice for ${campaignName} has been generated. `,
  };
};

const notificationInvoiceUpdate = (campaignName: string) => {
  return {
    title: `✏️ Heads up`,
    message: `Your ${campaignName} invoice was updated. Take a look`,
  };
};

// Creator-facing: invoice approved by Finance (In-App only)
const notificationInvoiceApproved = (campaignName: string, paymentDate: string) => {
  return {
    title: `🙌 Invoice approved for ${campaignName}`,
    message: `Payment scheduled for ${paymentDate}`,
  };
};

// Creator-facing: payment made (Push + In-App)
const notificationInvoicePaid = (campaignName: string) => {
  return {
    title: `🎉 Cha-ching`,
    message: `Your ${campaignName} payment just landed`,
  };
};

const notificationInvoiceStatus = (campaignName: string) => {
  return {
    title: `💰 Invoice Updated!`,
    message: ` The payment status of your invoice for ${campaignName} has been updated. `,
  };
};

const reminderDueDate = (
  campaignName: string,
  dueDate: string,
  type: 'Posting' | 'Draft' | 'Agreement',
  creatorName?: string,
) => {
  if (type === 'Posting') {
    return {
      message: `Your post for ${campaignName} is due on ${dueDate}. `,
      title: '⏳ Posting Due Soon!',
    };
  }

  if (type === 'Draft') {
    return {
      message: `Your draft for ${campaignName} is due on ${dueDate}. Please make sure to submit it on time.`,
      title: '⏳ Draft Due Soon!',
    };
  }

  if (type === 'Agreement') {
    return {
      message: `Just a reminder that the agreement for the ${campaignName} is due on ${dueDate}. Please review and submit it before the deadline.`,
      title: '⏳ Agreement Due Soon!',
    };
  }
};

// Escalation reminders (nudges sent when a creator hasn't actioned a step)
const escalationAgreementUnsigned = (campaignName: string) => {
  return {
    title: '⏰ Agreement still waiting on your signature',
    message: `Your ${campaignName} agreement is still waiting on your signature.`,
  };
};

const escalationDraftNotSubmitted = (campaignName: string) => {
  return {
    title: '⏰ Your draft is due soon',
    message: `Your ${campaignName} draft is due soon - let's get it in.`,
  };
};

const escalationPostingNotSubmitted = (campaignName: string) => {
  return {
    title: '⏰ Posting link reminder',
    message: `Don't forget to drop your posting link for ${campaignName}.`,
  };
};

// helper function for Client notifications
const notificationPitchForClientReview = (campaignName: string) => {
  return {
    title: '📬 New creator profiles are ready for you to check out',
    message: `Admins have sent you creators for the ${campaignName} campaign. Please review their profile`,
  };
};

export {
  notificationCampaignLive,
  notificationMaintenance,
  notificationAdminAssign,
  notificationPitch,
  notificationDraft,
  notificationAgreement,
  notificationPendingAgreement,
  notificationSignature,
  notificationApproveAgreement,
  notificationApproveDraft,
  notificationRejectDraft,
  notificationPosting,
  notificationCSMChat,
  notificationGroupChat,
  notificationLogisticDelivery,
  notificationLogisticTracking,
  notificationLogisticShipped,
  notificationInvoiceGenerate,
  notificationInvoiceStatus,
  notificationInvoiceUpdate,
  notificationInvoiceApproved,
  notificationInvoicePaid,
  reminderDueDate,
  escalationAgreementUnsigned,
  escalationDraftNotSubmitted,
  escalationPostingNotSubmitted,
  notificationPitchForClientReview,
};
