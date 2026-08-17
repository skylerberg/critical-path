import { readFile } from 'node:fs/promises';

interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

interface TrelloMember {
  id: string;
  username: string;
  fullName: string;
}

interface TrelloAttachment {
  id: string;
  name: string;
  bytes: number | null;
  date: string;
  mimeType: string | null;
  isUpload: boolean;
  url: string;
  pos: number;
}

export interface TrelloCard {
  id: string;
  idShort: number;
  name: string;
  desc: string;
  closed: boolean;
  pos: number;
  url: string;
  shortUrl: string;
  idList: string;
  idLabels: string[];
  idMembers: string[];
  idChecklists: string[];
  idAttachmentCover: string | null;
  dateLastActivity: string;
  dateClosed: string | null;
  attachments: TrelloAttachment[];
  badges: { comments: number };
}

interface TrelloCheckItem {
  id: string;
  name: string;
  pos: number;
  state: string;
}

interface TrelloChecklist {
  id: string;
  idCard: string;
  name: string;
  pos: number;
  checkItems: TrelloCheckItem[];
}

export interface TrelloActionData {
  idCard?: string;
  text?: string;
  card?: { id?: string };
}

// Which field names the commented-on card, in one place because the two sources
// disagree and the disagreement is silent: the export writes `idCard`, while the
// live board-actions endpoint puts it under `card.id` and carries `idCard` on
// only the oldest handful. Reading one alone drops most of the comments and
// still looks like a clean run.
export function actionCardId(data: TrelloActionData): string | null {
  return data.card?.id ?? data.idCard ?? null;
}

interface TrelloCommentAction {
  id: string;
  type: string;
  date: string;
  idMemberCreator: string;
  data: TrelloActionData;
  memberCreator: { username: string; fullName: string } | null;
}

export interface TrelloBoard {
  id: string;
  name: string;
  shortUrl: string;
  labels: TrelloLabel[];
  lists: TrelloList[];
  members: TrelloMember[];
  cards: TrelloCard[];
  checklists: TrelloChecklist[];
  actions: TrelloCommentAction[];
}

export async function loadBoard(path: string): Promise<TrelloBoard> {
  const board = JSON.parse(await readFile(path, 'utf8')) as TrelloBoard;
  for (const key of ['cards', 'lists', 'labels', 'checklists', 'members'] as const) {
    if (!Array.isArray(board[key])) {
      throw new Error(`${path} does not look like a Trello board export: no "${key}" array`);
    }
  }
  return board;
}

// Trello ids are Mongo ObjectIds and their first four bytes are the creation
// time, which is the only place a card's original date survives an export
// whose action log is capped at the most recent 1000 entries.
export function createdAt(trelloId: string): Date {
  return new Date(parseInt(trelloId.slice(0, 8), 16) * 1000);
}

export function isoDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}
