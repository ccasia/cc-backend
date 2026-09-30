import { ReleaseNoteItemType } from '@prisma/client';

export interface ReleaseNoteItemInput {
  type: ReleaseNoteItemType;
  title: string;
  description: string;
}

export interface ReleaseNoteInput {
  releaseDate: Date;
  items: ReleaseNoteItemInput[];
  publish: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };