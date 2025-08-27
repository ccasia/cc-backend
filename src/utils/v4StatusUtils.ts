/**
 * V4 Submission Status Utilities
 * Handles status transitions and role-specific status display logic
 */
import { SubmissionStatus, FeedbackStatus } from '@prisma/client';

export type V4UserRole = 'creator' | 'admin' | 'client';

/**
 * Get role-specific status display for submissions
 */
export const getSubmissionStatusDisplay = (
  submissionStatus: SubmissionStatus,
  videoStatus: FeedbackStatus,
  userRole: V4UserRole,
  campaignOrigin: 'ADMIN' | 'CLIENT'
): string => {
  switch (submissionStatus) {
    case 'PENDING_REVIEW':
      switch (userRole) {
        case 'creator':
          return 'In Review';
        case 'admin':
          return 'Pending Review';
        case 'client':
          return 'In Progress';
      }
      break;
    
    case 'SENT_TO_CLIENT':
      switch (userRole) {
        case 'creator':
          return 'In Review';
        case 'admin':
          return 'Sent to Client';
        case 'client':
          return 'Pending Review';
      }
      break;
    
    case 'CLIENT_FEEDBACK':
      switch (userRole) {
        case 'creator':
          return 'In Review';
        case 'admin':
          return 'Client Feedback Received';
        case 'client':
          return 'In Progress';
      }
      break;
    
    case 'CHANGES_REQUIRED':
      switch (userRole) {
        case 'creator':
          return 'Re-upload Videos';
        case 'admin':
          return 'In Progress';
        case 'client':
          return 'In Progress';
      }
      break;
    
    case 'APPROVED':
      return 'Approved';
    
    case 'CLIENT_APPROVED':
      return 'Approved';
    
    case 'POSTED':
      return 'Posted';
    
    default:
      return submissionStatus;
  }
  
  return submissionStatus;
};

/**
 * Check if creator can upload content based on current status
 */
export const canCreatorUpload = (
  submissionStatus: SubmissionStatus,
  videoStatus: FeedbackStatus
): boolean => {
  // Creator can only upload when:
  // 1. Submission is not started or changes are required
  // 2. Video status allows for new uploads
  
  const allowedSubmissionStatuses: SubmissionStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS', 
    'CHANGES_REQUIRED'
  ];
  
  const allowedVideoStatuses: FeedbackStatus[] = [
    'PENDING',
    'REVISION_REQUESTED'
  ];
  
  return allowedSubmissionStatuses.includes(submissionStatus) ||
         allowedVideoStatuses.includes(videoStatus);
};

/**
 * Check if posting link can be added
 */
export const canAddPostingLink = (
  submissionStatus: SubmissionStatus,
  videoStatus: FeedbackStatus
): boolean => {
  // Posting link can be added when:
  // 1. Both submission and video are fully approved, OR
  // 2. Submission is CLIENT_APPROVED (regardless of video status)
  return (submissionStatus === 'APPROVED' && videoStatus === 'APPROVED') ||
         submissionStatus === 'CLIENT_APPROVED';
};

/**
 * Get next status after admin action
 */
export const getNextStatusAfterAdminAction = (
  action: 'approve' | 'reject' | 'request_revision',
  campaignOrigin: 'ADMIN' | 'CLIENT'
): {
  submissionStatus: SubmissionStatus;
  videoStatus: FeedbackStatus;
} => {
  switch (action) {
    case 'approve':
      if (campaignOrigin === 'CLIENT') {
        return {
          submissionStatus: 'SENT_TO_CLIENT',
          videoStatus: 'PENDING'
        };
      } else {
        return {
          submissionStatus: 'APPROVED',
          videoStatus: 'APPROVED'
        };
      }
    
    case 'reject':
      return {
        submissionStatus: 'REJECTED',
        videoStatus: 'REJECTED'
      };
    
    case 'request_revision':
      return {
        submissionStatus: 'CHANGES_REQUIRED',
        videoStatus: 'REVISION_REQUESTED'
      };
    
    default:
      return {
        submissionStatus: 'PENDING_REVIEW',
        videoStatus: 'PENDING'
      };
  }
};

/**
 * Get next status after client action
 */
export const getNextStatusAfterClientAction = (
  action: 'approve' | 'request_changes'
): {
  submissionStatus: SubmissionStatus;
  videoStatus: FeedbackStatus;
} => {
  switch (action) {
    case 'approve':
      return {
        submissionStatus: 'CLIENT_APPROVED',
        videoStatus: 'APPROVED'
      };
    
    case 'request_changes':
      return {
        submissionStatus: 'CLIENT_FEEDBACK',
        videoStatus: 'CLIENT_FEEDBACK'
      };
    
    default:
      return {
        submissionStatus: 'SENT_TO_CLIENT',
        videoStatus: 'PENDING'
      };
  }
};

/**
 * Get next status after admin forwards client feedback
 */
export const getStatusAfterForwardingClientFeedback = (): {
  submissionStatus: SubmissionStatus;
  videoStatus: FeedbackStatus;
} => {
  return {
    submissionStatus: 'CHANGES_REQUIRED',
    videoStatus: 'REVISION_REQUESTED'
  };
};

/**
 * Validate status transition
 */
export const isValidStatusTransition = (
  currentSubmissionStatus: SubmissionStatus,
  currentVideoStatus: FeedbackStatus,
  newSubmissionStatus: SubmissionStatus,
  newVideoStatus: FeedbackStatus,
  userRole: V4UserRole
): boolean => {
  // Define valid transitions based on user role and current status
  const validTransitions: Record<string, string[]> = {
    'creator': [
      'NOT_STARTED->PENDING_REVIEW',
      'CHANGES_REQUIRED->PENDING_REVIEW'
    ],
    'admin': [
      'PENDING_REVIEW->SENT_TO_CLIENT',
      'PENDING_REVIEW->APPROVED', 
      'PENDING_REVIEW->CHANGES_REQUIRED',
      'CLIENT_FEEDBACK->CHANGES_REQUIRED'
    ],
    'client': [
      'SENT_TO_CLIENT->CLIENT_APPROVED',
      'SENT_TO_CLIENT->CLIENT_FEEDBACK'
    ]
  };
  
  const transitionKey = `${currentSubmissionStatus}->${newSubmissionStatus}`;
  return validTransitions[userRole]?.includes(transitionKey) || false;
};

/**
 * Get available actions for user role and current status
 */
export const getAvailableActions = (
  submissionStatus: SubmissionStatus,
  videoStatus: FeedbackStatus,
  userRole: V4UserRole,
  campaignOrigin: 'ADMIN' | 'CLIENT'
): string[] => {
  const actions: string[] = [];
  
  switch (userRole) {
    case 'creator':
      if (canCreatorUpload(submissionStatus, videoStatus)) {
        actions.push('upload');
      }
      if (canAddPostingLink(submissionStatus, videoStatus)) {
        actions.push('add_posting_link');
      }
      break;
    
    case 'admin':
      if (submissionStatus === 'PENDING_REVIEW') {
        actions.push('approve', 'request_revision');
      }
      if (submissionStatus === 'CLIENT_FEEDBACK') {
        actions.push('forward_to_creator');
      }
      break;
    
    case 'client':
      if (submissionStatus === 'SENT_TO_CLIENT' && campaignOrigin === 'CLIENT') {
        actions.push('approve', 'request_changes');
      }
      break;
  }
  
  return actions;
};