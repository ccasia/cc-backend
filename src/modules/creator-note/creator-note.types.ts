export interface NoteUser {
  id: string;
  name: string | null;
  photoURL: string | null;
}

export interface NoteDto {
  id: string;
  campaignId: string;
  creatorId: string;
  text: string;
  mentions: string[];
  isPinned: boolean;
  pinnedAt: Date | null;
  createdAt: Date;
  author: NoteUser;
}

export interface NoteSummary {
  creatorId: string;
  noteCount: number;
  unreadCount: number;
  pinned: NoteDto | null;
  lastNote: NoteDto | null;
}

export interface PinResult {
  pinned: NoteDto | null;
  unpinned: NoteDto | null;
}
