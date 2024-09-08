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

const notificationDraft = (campaignName: string, type: 'Admin' | 'Creator', creatorName?: string) => {
  if (type === 'Admin') {
    return {
      title: '📬 New Draft Received!',
      message: `A new draft for the ${campaignName} has been submitted by ${creatorName}.`,
    };
  }
  return {
    title: '📝 Draft Sent Successfully!',
    message: `Your draft for the ${campaignName} has been sent. We’ll review it and let you know if any changes are needed`,
  };
};

const notificationAgreement = (campaignName: string, type: 'Admin' | 'Creator', creatorName?: string) => {
  if (type === 'Admin') {
    return {
      title: '📄 New Agreement Sent!',
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
    title: '✅ Agreement Approved!',
    message: `Your agreement for the ${campaignName} has been approved. You’re all set to move forward!`,
  };
};

const notificationApproveDraft = (campaignName: string, draft: string) => {
  return {
    title: `✅ ${draft} Approved!`,
    message: `Your ${draft} for [Campaign Name] has been approved. Great work!`,
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

export {
  notificationPitch,
  notificationDraft,
  notificationAgreement,
  notificationApproveAgreement,
  notificationApproveDraft,
  notificationRejectDraft,
  notificationPosting,
  reminderDueDate,
};
