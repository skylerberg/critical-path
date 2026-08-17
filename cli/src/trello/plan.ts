import type { TiptapDoc } from '../markdown/toTiptap';
import { hexForTrelloColor } from './colors';
import { createdAt, isoDay, type TrelloBoard, type TrelloCard, type TrelloList } from './export';
import { attachmentId, checklistItemId, columnId, commentId, labelId, taskId } from './ids';
import { concatDocuments, escapeInline, rewriteImageSources, toDocument } from './markdown';

// Cards whose Trello list was archived have nowhere faithful to land: a column
// carries no archived state. They keep their own archived flag and collect here,
// with the list they came from recorded in the footer.
const ARCHIVED_COLUMN_NAME = 'Archived (Trello)';
const ARCHIVED_COLUMN_KEY = 'synthetic:archived';

interface PlannedColumn {
  id: string;
  name: string;
  isDone: boolean;
}

interface PlannedLabel {
  id: string;
  name: string;
  color: string;
}

export interface PlannedTask {
  id: string;
  columnId: string;
  title: string;
  description: TiptapDoc;
  labelIds: string[];
  assigneeIds: string[];
  archived: boolean;
  cardNumber: number;
}

interface PlannedChecklistItem {
  id: string;
  taskId: string;
  text: string;
  checked: boolean;
}

interface PlannedAttachment {
  id: string;
  taskId: string;
  filename: string;
  url: string;
  isCover: boolean;
}

interface PlannedComment {
  id: string;
  taskId: string;
  body: TiptapDoc;
}

export interface SourceComment {
  id: string;
  cardId: string;
  author: string;
  date: string;
  text: string;
}

export interface PlanOptions {
  // Trello member id -> Critical Path user uuid. A member left out keeps their
  // assignment as a footer line rather than losing it.
  assigneeMap: Map<string, string>;
  doneListNames: Set<string>;
  comments: SourceComment[];
}

export interface ImportPlan {
  columns: PlannedColumn[];
  labels: PlannedLabel[];
  tasks: PlannedTask[];
  checklistItems: PlannedChecklistItem[];
  attachments: PlannedAttachment[];
  comments: PlannedComment[];
  unmappedMembers: Map<string, number>;
}

function footerMarkdown(card: TrelloCard, list: TrelloList, unmappedNames: string[]): string {
  const lines = [
    `Imported from Trello — card #${String(card.idShort)} · [${escapeInline(
      card.shortUrl.replace(/^https?:\/\//, '')
    )}](${card.shortUrl})`,
    `Created ${isoDay(createdAt(card.id))} · Last activity ${isoDay(
      card.dateLastActivity
    )} · List: ${escapeInline(list.name)}`,
  ];
  if (card.dateClosed !== null) {
    lines.push(`Archived ${isoDay(card.dateClosed)}`);
  }
  if (unmappedNames.length > 0) {
    lines.push(`Assigned in Trello to ${escapeInline(unmappedNames.join(', '))}`);
  }
  return `---\n\n${lines.map((line) => `*${line}*`).join('\n\n')}\n`;
}

function commentMarkdown(comment: SourceComment): string {
  return `*${escapeInline(comment.author)} · ${isoDay(comment.date)}*\n`;
}

export function buildPlan(board: TrelloBoard, options: PlanOptions): ImportPlan {
  const listsById = new Map(board.lists.map((list) => [list.id, list]));
  const activeLists = board.lists.filter((list) => !list.closed).sort((a, b) => a.pos - b.pos);

  const columns: PlannedColumn[] = activeLists.map((list) => ({
    id: columnId(list.id),
    name: list.name,
    isDone: options.doneListNames.has(list.name),
  }));
  const archivedColumnId = columnId(ARCHIVED_COLUMN_KEY);
  columns.push({ id: archivedColumnId, name: ARCHIVED_COLUMN_NAME, isDone: false });

  const labels: PlannedLabel[] = board.labels.map((label) => ({
    id: labelId(label.id),
    // A Trello label may carry no name at all; the API requires 1-100 chars.
    name: label.name.trim() === '' ? `Untitled (${label.color ?? 'no colour'})` : label.name,
    color: hexForTrelloColor(label.color),
  }));

  const imageSources = new Map<string, string>();
  for (const card of board.cards) {
    for (const attachment of card.attachments) {
      imageSources.set(attachment.url, `/api/images/${attachmentId(attachment.id)}`);
    }
  }

  const membersById = new Map(board.members.map((member) => [member.id, member]));
  const unmappedMembers = new Map<string, number>();

  // Within a column, Trello's own order. The synthetic archived column keeps its
  // cards grouped by the list they came from, in that list's board order.
  const orderOf = (card: TrelloCard): [number, number] => {
    const list = listsById.get(card.idList);
    if (list === undefined) throw new Error(`Card ${card.id} names unknown list ${card.idList}`);
    return list.closed ? [list.pos, card.pos] : [0, card.pos];
  };

  const byColumn = new Map<string, TrelloCard[]>();
  for (const card of board.cards) {
    const list = listsById.get(card.idList);
    if (list === undefined) throw new Error(`Card ${card.id} names unknown list ${card.idList}`);
    const target = list.closed ? archivedColumnId : columnId(list.id);
    const bucket = byColumn.get(target);
    if (bucket === undefined) byColumn.set(target, [card]);
    else bucket.push(card);
  }

  const tasks: PlannedTask[] = [];
  for (const column of columns) {
    const cards = (byColumn.get(column.id) ?? []).sort((a, b) => {
      const [aList, aPos] = orderOf(a);
      const [bList, bPos] = orderOf(b);
      return aList - bList || aPos - bPos;
    });
    for (const card of cards) {
      const list = listsById.get(card.idList)!;
      const assigneeIds: string[] = [];
      const unmappedNames: string[] = [];
      for (const memberId of card.idMembers) {
        const mapped = options.assigneeMap.get(memberId);
        if (mapped !== undefined) {
          assigneeIds.push(mapped);
          continue;
        }
        const name = membersById.get(memberId)?.fullName ?? memberId;
        unmappedNames.push(name);
        unmappedMembers.set(name, (unmappedMembers.get(name) ?? 0) + 1);
      }
      const body = card.desc.trim() === '' ? null : rewriteImageSources(card.desc, imageSources);
      tasks.push({
        id: taskId(card.id),
        columnId: column.id,
        title: card.name,
        description: concatDocuments(
          ...(body === null ? [] : [toDocument(body)]),
          toDocument(footerMarkdown(card, list, unmappedNames))
        ),
        labelIds: card.idLabels.map(labelId),
        assigneeIds,
        archived: card.closed,
        cardNumber: card.idShort,
      });
    }
  }

  const cardIds = new Set(board.cards.map((card) => card.id));
  const checklistItems: PlannedChecklistItem[] = [];
  for (const checklist of board.checklists) {
    if (!cardIds.has(checklist.idCard)) continue;
    // Critical Path holds one flat, unnamed list per card, so a checklist that
    // was named something meaningful says so on each of its items.
    const prefix = /^checklist$/i.test(checklist.name.trim()) ? '' : `[${checklist.name}] `;
    for (const item of [...checklist.checkItems].sort((a, b) => a.pos - b.pos)) {
      checklistItems.push({
        id: checklistItemId(item.id),
        taskId: taskId(checklist.idCard),
        text: `${prefix}${item.name}`,
        checked: item.state === 'complete',
      });
    }
  }

  const attachments: PlannedAttachment[] = [];
  for (const card of board.cards) {
    for (const attachment of [...card.attachments].sort((a, b) => a.pos - b.pos)) {
      attachments.push({
        id: attachmentId(attachment.id),
        taskId: taskId(card.id),
        filename: attachment.name,
        url: attachment.url,
        isCover: card.idAttachmentCover === attachment.id,
      });
    }
  }

  const comments: PlannedComment[] = options.comments
    .filter((comment) => cardIds.has(comment.cardId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((comment) => ({
      id: commentId(comment.id),
      taskId: taskId(comment.cardId),
      body: concatDocuments(toDocument(commentMarkdown(comment)), toDocument(comment.text)),
    }));

  return { columns, labels, tasks, checklistItems, attachments, comments, unmappedMembers };
}
