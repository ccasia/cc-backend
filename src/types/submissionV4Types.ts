export interface V4SubmissionCreateData {
  campaignId: string;
  userId: string;
  ugcVideos: number; // Number of regular videos
  rawFootage: number; // Number of raw footage videos  
  photos: boolean; // Whether photos are required
}

export interface V4SubmissionResponse {
  id: string;
  submissionType: {
    type: string;
  };
  status: string;
  content: string | null; // Posting link
  contentOrder: number | null;
  submissionVersion: string;
  createdAt: string;
  video: Array<{
    id: string;
    url: string | null;
    status: string;
  }>;
  photos: Array<{
    id: string;
    url: string;
    status: string;
  }>;
  rawFootages: Array<{
    id: string;
    url: string;
    status: string;
  }>;
}

export interface PostingLinkUpdate {
  submissionId: string;
  postingLink: string;
}

export interface V4ContentSubmission {
  submissionId: string;
  videoUrls?: string[];
  photoUrls?: string[];
  rawFootageUrls?: string[];
  caption?: string;
}

export type V4SubmissionType = 'AGREEMENT_FORM' | 'VIDEO' | 'PHOTO' | 'RAW_FOOTAGE';

export type V4SubmissionStatus = 
  | 'PENDING_REVIEW' 
  | 'IN_PROGRESS' 
  | 'APPROVED' 
  | 'REJECTED' 
  | 'SENT_TO_CLIENT' 
  | 'CLIENT_APPROVED' 
  | 'CLIENT_FEEDBACK'
  | 'SENT_TO_ADMIN';