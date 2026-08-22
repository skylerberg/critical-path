import { actionCardId, type TrelloActionData } from './export';
import type { SourceComment } from './plan';

export interface TrelloCredentials {
  key: string;
  token: string;
}

// Trello stopped accepting key/token as query parameters on attachment
// downloads; the OAuth1 header is the one form both the REST endpoints and the
// attachment host accept, so everything here uses it.
function authHeader({ key, token }: TrelloCredentials): Record<string, string> {
  return { Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"` };
}

async function request(url: string, credentials: TrelloCredentials): Promise<Response> {
  const response = await fetch(url, { headers: authHeader(credentials) });
  if (!response.ok) {
    throw new Error(`Trello ${String(response.status)} for ${url}: ${await response.text()}`);
  }
  return response;
}

interface ActionResponse {
  id: string;
  date: string;
  data: TrelloActionData;
  memberCreator: { username: string; fullName: string | null } | null;
}

// The export caps its action log at the most recent 1000 entries, which is why
// almost every comment on an old board is missing from it. The board actions
// endpoint pages backwards without that ceiling.
export async function fetchComments(
  boardId: string,
  credentials: TrelloCredentials,
  onProgress: (count: number) => void
): Promise<SourceComment[]> {
  const collected = new Map<string, SourceComment>();
  let before: string | null = null;
  for (;;) {
    const url = new URL(`https://api.trello.com/1/boards/${boardId}/actions`);
    url.searchParams.set('filter', 'commentCard');
    url.searchParams.set('limit', '1000');
    if (before !== null) url.searchParams.set('before', before);
    const page = (await (await request(url.toString(), credentials)).json()) as ActionResponse[];
    if (page.length === 0) break;
    for (const action of page) {
      const cardId = actionCardId(action.data);
      if (cardId === null || action.data.text === undefined) continue;
      collected.set(action.id, {
        id: action.id,
        cardId,
        author: action.memberCreator?.fullName ?? action.memberCreator?.username ?? 'a Trello user',
        date: action.date,
        text: action.data.text,
      });
    }
    onProgress(collected.size);
    const oldest = page[page.length - 1]!.date;
    if (page.length < 1000 || oldest === before) break;
    before = oldest;
  }
  return [...collected.values()];
}

export async function downloadAttachment(
  url: string,
  credentials: TrelloCredentials
): Promise<Buffer> {
  const response = await request(url, credentials);
  return Buffer.from(await response.arrayBuffer());
}

export function readCredentials(): TrelloCredentials {
  const key = process.env['TRELLO_KEY'];
  const token = process.env['TRELLO_TOKEN'];
  if (key === undefined || token === undefined || key === '' || token === '') {
    throw new Error(
      'TRELLO_KEY and TRELLO_TOKEN must be set. Create ~/.config/trello-import.env holding both ' +
        'and run this with `node --env-file=$HOME/.config/trello-import.env`.'
    );
  }
  return { key, token };
}
