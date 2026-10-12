import { EventEmitter } from 'events';

/**
 * In-process events for posting links. Emitters never wait on listeners, so a
 * slow or failing listener can never delay or fail the HTTP response.
 */

export const POSTING_LINK_APPROVED_EVENT = 'posting-link:approved';

export interface PostingLinkApprovedPayload {
  submissionId: string;
}

export const postingLinkEvents = new EventEmitter();

/** A submission reached POSTED with links: approved, or a link added to a POSTED submission. */
export const emitPostingLinkApproved = (payload: PostingLinkApprovedPayload): void => {
  postingLinkEvents.emit(POSTING_LINK_APPROVED_EVENT, payload);
};
