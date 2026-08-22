import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import TaskAttachments from './TaskAttachments.svelte';
import { board, type TaskAttachment } from '../lib/board.svelte';
import { realtimeEvent } from '../lib/realtime-test-events';
import { testUuid } from '../lib/test-ids';
import { toasts } from '../lib/toasts.svelte';
import type { BoardTask } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');
const T1 = testUuid('t1');
const jsdomCreateObjectURL = URL.createObjectURL;
const jsdomRevokeObjectURL = URL.revokeObjectURL;

function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: id,
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    column_since: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
    ...overrides,
  };
}

function attachment(id: string, overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    id: testUuid(id),
    task_id: T1,
    kind: 'file',
    image_url: null,
    is_cover: false,
    title: null,
    description: null,
    filename: 'spec.pdf',
    content_type: 'application/pdf',
    size_bytes: 13_000_000,
    url: null,
    preview_url: null,
    favicon_url: null,
    unfurl_state: null,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

function link(id: string, overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return attachment(id, {
    kind: 'link',
    filename: null,
    content_type: null,
    size_bytes: null,
    url: 'https://figma.com/file/abc',
    unfurl_state: 'ok',
    ...overrides,
  });
}

function image(id: string, overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return attachment(id, {
    kind: 'image',
    image_url: `/api/images/${testUuid(id)}`,
    filename: 'mock.png',
    content_type: 'image/png',
    size_bytes: 2048,
    ...overrides,
  });
}

function renderSection(props: { taskId?: string; readonly?: boolean } = {}) {
  return render(TaskAttachments, { taskId: T1, ...props });
}

async function requestBody(callIndex: number): Promise<unknown> {
  return await requestAt(callIndex).clone().json();
}

// A rename writes the response body over the row it sent, so a blanket 204 would
// leave `undefined` in the list. Everything else here keeps the 204.
async function attachmentApi(input: RequestInfo | URL): Promise<Response> {
  const request = input as Request;
  const { pathname } = new URL(request.url);
  const prefix = '/api/attachments/';
  if (pathname.startsWith(prefix) && request.method === 'PATCH') {
    const id = pathname.slice(prefix.length);
    const patch = (await request.clone().json()) as Partial<TaskAttachment>;
    return jsonResponse(200, { ...attachment('a1'), id, ...patch });
  }
  return jsonResponse(204);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(attachmentApi);
  board.reset();
  toasts.toasts = [];
  board.currentProjectId = PROJECT_ID;
  board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
  board.tasks = [task(T1)];
  board.taskAttachments = { [T1]: [] };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TaskAttachments empty state', () => {
  it('invites an editor to drop or link and stays terse for a viewer', () => {
    const { unmount } = renderSection();
    expect(
      screen.getByText('Nothing attached yet. Drop a file here, or add a link.')
    ).toBeVisible();
    unmount();

    renderSection({ readonly: true });
    expect(screen.getByText('No attachments.')).toBeVisible();
  });

  it('renders no list area at all while the detail payload is still loading', () => {
    board.taskAttachments = {};
    renderSection();

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeVisible();
  });
});

describe('TaskAttachments file rows', () => {
  it('renders a download button, the size and the type, and never an image', () => {
    board.taskAttachments = { [T1]: [attachment('a1')] };
    renderSection();

    expect(screen.getByText('spec.pdf')).toBeVisible();
    expect(screen.getByText('12.4 MB · PDF')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download spec.pdf' })).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('fetches the blob and mints then revokes an object URL on download', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const clicked: HTMLAnchorElement[] = [];
    // A subclass, never `Object.assign(URL, …)`: assigning onto the live global
    // leaves the two spies on it, and `vi.unstubAllGlobals()` restores a binding
    // rather than an object — so every later test would go on calling these.
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => {
          created.push('blob:x');
          return 'blob:x';
        }),
        revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
      })
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });
    fetchMock.mockImplementation(async () => new Response(new Blob(['bytes']), { status: 200 }));
    board.taskAttachments = { [T1]: [attachment('a1')] };
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Download spec.pdf' }));
    await waitFor(() => expect(created).toHaveLength(1));
    // The revoke is deferred a task so the browser has read the blob first.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestAt(0).url).toContain(`/api/attachments/${testUuid('a1')}/download`);
    expect(clicked[0]?.download).toBe('spec.pdf');
    expect(revoked).toEqual(['blob:x']);
  });

  // `vi.unstubAllGlobals()` restores a binding, not an object, so a stub written
  // onto the live global outlives the test that made it — for the whole file.
  it('hands the global URL back the way jsdom left it', () => {
    expect(URL.createObjectURL).toBe(jsdomCreateObjectURL);
    expect(URL.revokeObjectURL).toBe(jsdomRevokeObjectURL);
  });

  it('keeps Download but hides every mutation for a viewer', () => {
    board.taskAttachments = { [T1]: [attachment('a1')] };
    renderSection({ readonly: true });

    expect(screen.getByRole('button', { name: 'Download spec.pdf' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Attach file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename spec.pdf' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete spec.pdf' })).not.toBeInTheDocument();
  });
});

describe('TaskAttachments link rows', () => {
  it('renders the favicon, host, description and preview with a hardened anchor', () => {
    board.taskAttachments = {
      [T1]: [
        link('a1', {
          title: 'Design file',
          description: 'The board layout',
          preview_url: `/api/attachments/${testUuid('a1')}/preview`,
          favicon_url: `/api/attachments/${testUuid('a1')}/favicon`,
        }),
      ],
    };
    renderSection();

    const anchor = screen.getByRole('link', { name: 'Design file' });
    expect(anchor).toHaveAttribute('href', 'https://figma.com/file/abc');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(screen.getByText('figma.com')).toBeVisible();
    expect(screen.getByText('The board layout')).toBeVisible();

    const images = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(images).toContain(`/api/attachments/${testUuid('a1')}/preview`);
    expect(images).toContain(`/api/attachments/${testUuid('a1')}/favicon`);
  });

  it('falls back to the hostname when the unfurl found no title', () => {
    board.taskAttachments = { [T1]: [link('a1')] };
    renderSection();

    expect(screen.getByRole('link', { name: 'figma.com' })).toBeVisible();
  });

  it('renders a javascript: url as plain text with no href', () => {
    board.taskAttachments = { [T1]: [link('a1', { url: 'javascript:alert(1)', title: 'Trap' })] };
    renderSection();

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Trap')).toBeVisible();
  });

  it('renders a hostile title and description as text, never as markup', () => {
    board.taskAttachments = {
      [T1]: [
        link('a1', {
          title: '<img src=x onerror=alert(1)>',
          description: '<script>alert(2)</script>',
        }),
      ],
    };
    renderSection();

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(screen.getByText('<script>alert(2)</script>')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });

  it('announces a pending unfurl politely and keeps the link usable', async () => {
    board.taskAttachments = { [T1]: [link('a1', { unfurl_state: 'pending' })] };
    renderSection();

    const live = screen.getByText('Fetching preview…');
    expect(live.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'figma.com' })).toHaveAttribute(
      'href',
      'https://figma.com/file/abc'
    );

    board.applyRealtime(
      realtimeEvent(
        'attachment_updated',
        link('a1', {
          title: 'Filled in',
          preview_url: `/api/attachments/${testUuid('a1')}/preview`,
        }),
        PROJECT_ID
      )
    );

    await waitFor(() => expect(screen.getByRole('link', { name: 'Filled in' })).toBeVisible());
    expect(screen.queryByText('Fetching preview…')).not.toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeNull();
  });

  it('shows a muted note for a failed unfurl, a visible Rename, and no toast', () => {
    board.taskAttachments = { [T1]: [link('a1', { unfurl_state: 'failed' })] };
    renderSection();

    expect(screen.getByText('No preview available')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rename figma.com' })).toHaveClass('opacity-100');
    expect(toasts.toasts).toHaveLength(0);
  });
});

describe('TaskAttachments add link', () => {
  it('posts a valid URL and closes the sub-form', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(201, link('a1')));
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const input = screen.getByRole('textbox', { name: 'Link address' });
    await fireEvent.input(input, { target: { value: 'https://example.com/doc' } });
    await fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestAt(0).url).toContain('/api/attachments/links');
    expect(await requestBody(0)).toMatchObject({ task_id: T1, url: 'https://example.com/doc' });
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument();
  });

  it('shows an inline alert for an invalid URL and posts nothing', async () => {
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const input = screen.getByRole('textbox', { name: 'Link address' });
    await fireEvent.input(input, { target: { value: 'ftp://nope' } });
    await fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a link starting with http:// or https://'
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toasts.toasts).toHaveLength(0);
  });

  it('closes the sub-form on Escape without letting the card see it', async () => {
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const input = screen.getByRole('textbox', { name: 'Link address' });

    let sawEscape = false;
    document.addEventListener('keydown', () => {
      sawEscape = true;
    });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
    );
    expect(event.defaultPrevented).toBe(true);
    expect(sawEscape).toBe(false);
  });
});

describe('TaskAttachments uploads', () => {
  function fileList(files: File[]): FileList {
    const list: Record<string | number | symbol, unknown> = { ...files };
    list.length = files.length;
    list.item = (index: number) => files[index] ?? null;
    list[Symbol.iterator] = function* () {
      yield* files;
    };
    return list as unknown as FileList;
  }

  it('shows a pending row synchronously and clears it when the upload resolves', async () => {
    let release!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    renderSection();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: fileList([new File(['x'], 'notes.txt', { type: 'text/plain' })]),
    });
    await fireEvent.change(input);

    expect(await screen.findByText('notes.txt')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Uploading notes.txt' })).toBeVisible();

    release(jsonResponse(201, attachment('a1', { filename: 'notes.txt', size_bytes: 1 })));
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Uploading notes.txt' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Download notes.txt' })).toBeVisible();
  });

  it('drops the pending row and raises a toast when the upload fails', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(413, { error: 'Payload too large' }));
    renderSection();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: fileList([new File(['x'], 'huge.zip', { type: '' })]),
    });
    await fireEvent.change(input);

    await waitFor(() => expect(toasts.toasts).toHaveLength(1));
    expect(toasts.toasts[0].message).toContain('Payload too large');
    expect(screen.queryByRole('status', { name: 'Uploading huge.zip' })).not.toBeInTheDocument();
  });

  it('accepts any file type: the picker declares no accept filter', () => {
    renderSection();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.hasAttribute('accept')).toBe(false);
    expect(input.multiple).toBe(true);
  });

  it('uploads dropped files and links a dropped uri-list', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(201, attachment('a1')));
    const { container } = renderSection();
    const zone = container.querySelector('div') as HTMLElement;

    await fireEvent.drop(zone, {
      dataTransfer: {
        types: ['Files'],
        files: fileList([new File(['x'], 'dropped.bin', { type: '' })]),
        getData: () => '',
      },
    });
    await waitFor(() => expect(requestAt(0).url).toContain('/api/attachments/files'));

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse(201, link('a2')));
    await fireEvent.drop(zone, {
      dataTransfer: {
        types: ['text/uri-list'],
        files: fileList([]),
        getData: (type: string) =>
          type === 'text/uri-list' ? 'https://example.com/dragged\nhttps://other' : '',
      },
    });

    await waitFor(() => expect(requestAt(0).url).toContain('/api/attachments/links'));
    expect(await requestBody(0)).toMatchObject({ url: 'https://example.com/dragged' });
  });

  it('sends every picked file to the one endpoint, whatever its type', async () => {
    fetchMock.mockImplementation(async (input) =>
      String((input as Request).url).includes('/images')
        ? jsonResponse(201, image('i1'))
        : jsonResponse(201, attachment('a1'))
    );
    renderSection();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: fileList([
        new File(['x'], 'shot.png', { type: 'image/png' }),
        new File(['x'], 'spec.pdf', { type: 'application/pdf' }),
      ]),
    });
    await fireEvent.change(input);

    // Which kind each becomes is the server's call, read from the bytes; the
    // component no longer carries a copy of that rule.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestAt(0).url).toContain('/api/attachments/files');
    expect(requestAt(1).url).toContain('/api/attachments/files');
  });

  // A viewer gets no buttons and no file input, so the drop zone is the only
  // write surface still reachable — and it is still drawn.
  it('refuses both kinds of drop for a viewer', async () => {
    const { container } = renderSection({ readonly: true });
    const zone = container.querySelector('div') as HTMLElement;

    await fireEvent.drop(zone, {
      dataTransfer: {
        types: ['Files'],
        files: fileList([new File(['x'], 'dropped.bin', { type: '' })]),
        getData: () => '',
      },
    });
    await fireEvent.drop(zone, {
      dataTransfer: {
        types: ['text/uri-list'],
        files: fileList([]),
        getData: (type: string) => (type === 'text/uri-list' ? 'https://example.com/dragged' : ''),
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('No attachments.')).toBeVisible();
  });

  it('sends a dropped SVG to the same endpoint as everything else', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(201, attachment('a1')));
    const { container } = renderSection();
    const zone = container.querySelector('div') as HTMLElement;

    await fireEvent.drop(zone, {
      dataTransfer: {
        types: ['Files'],
        files: fileList([new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })]),
        getData: () => '',
      },
    });

    await waitFor(() => expect(requestAt(0).url).toContain('/api/attachments/files'));
  });
});

describe('TaskAttachments images', () => {
  beforeEach(() => {
    board.tasks = [task(T1, { attachment_count: 1 })];
    board.taskAttachments = { [T1]: [image('i1')] };
  });

  it('shows images in the same section as files and links, with their own controls', () => {
    board.taskAttachments = { [T1]: [image('i1'), attachment('a1')] };
    renderSection();

    expect(screen.getByAltText('mock.png')).toHaveAttribute('src', `/api/images/${testUuid('i1')}`);
    expect(screen.getByRole('button', { name: 'Use image mock.png as cover' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete image mock.png' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download spec.pdf' })).toBeVisible();
  });

  it('keeps the empty copy away when the only thing attached is an image', () => {
    renderSection();

    expect(screen.getByAltText('mock.png')).toBeVisible();
    expect(
      screen.queryByText('Nothing attached yet. Drop a file here, or add a link.')
    ).not.toBeInTheDocument();
  });

  it('drops the cover and delete controls for a viewer', () => {
    renderSection({ readonly: true });

    expect(screen.getByAltText('mock.png')).toBeVisible();
    expect(screen.queryByRole('button', { name: /as cover$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete image/ })).toBeNull();
  });

  it('marks the image as the cover and unmarks it on a second press', async () => {
    renderSection();
    const toggle = screen.getByRole('button', { name: 'Use image mock.png as cover' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.click(toggle);
    await waitFor(() => expect(requestAt(0).url).toContain(`/api/tasks/${T1}/cover`));
    expect(await requestBody(0)).toEqual({ image_id: testUuid('i1') });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse(204));
    await fireEvent.click(toggle);
    await waitFor(() => expect(requestAt(0).url).toContain(`/api/tasks/${T1}/cover`));
    expect(await requestBody(0)).toEqual({ image_id: null });
  });

  it('deletes an image without the two-step confirm the attachment rows use', async () => {
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete image mock.png' }));

    await waitFor(() => expect(requestAt(0).url).toContain(`/api/attachments/${testUuid('i1')}`));
    expect(requestAt(0).method).toBe('DELETE');
    expect(screen.queryByAltText('mock.png')).not.toBeInTheDocument();
  });

  it('spins only while a task known to hold attachments is still loading them', () => {
    board.taskAttachments = {};
    const { unmount } = renderSection();
    expect(screen.getByRole('status', { name: 'Loading attachments' })).toBeVisible();
    unmount();

    board.tasks = [task(T1, { attachment_count: 0 })];
    renderSection();
    expect(screen.queryByRole('status', { name: 'Loading attachments' })).not.toBeInTheDocument();
  });
});

describe('TaskAttachments rename and delete', () => {
  it('writes only the title, never the filename', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, attachment('a1', { title: 'The spec' }))
    );
    board.taskAttachments = { [T1]: [attachment('a1')] };
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename spec.pdf' }));
    const input = screen.getByRole('textbox', { name: 'Rename spec.pdf' });
    await fireEvent.input(input, { target: { value: 'The spec' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestAt(0).url).toContain(`/api/attachments/${testUuid('a1')}`);
    expect(await requestBody(0)).toEqual({ title: 'The spec' });
    expect(board.taskAttachments[T1][0].filename).toBe('spec.pdf');
  });

  // This section lives inside the task overlay, so it goes when the card is
  // dismissed — and dismissing it does not blur the title being renamed.
  // Opened to replace the title, not to append to it, so the whole value is selected.
  it('opens the rename editor focused with its text selected', async () => {
    board.taskAttachments = { [T1]: [attachment('a1')] };
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename spec.pdf' }));

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename spec.pdf' });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('writes a rename left open when the section unmounts', async () => {
    const patch = vi.spyOn(board, 'patchAttachment');
    board.taskAttachments = { [T1]: [attachment('a1')] };
    const { unmount } = renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename spec.pdf' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Rename spec.pdf' }), {
      target: { value: 'The spec' },
    });
    unmount();

    expect(patch).toHaveBeenCalledWith(T1, testUuid('a1'), { title: 'The spec' });
    // Awaited rather than polled: the optimistic row already carries the title,
    // so only the settled write shows whether the fixture answered with a row or
    // with the `undefined` a blanket 204 stores over it.
    await patch.mock.results[0].value;
    expect(board.taskAttachments[T1][0].title).toBe('The spec');
  });

  it('still discards on Escape when the section then unmounts', async () => {
    const patch = vi.spyOn(board, 'patchAttachment');
    board.taskAttachments = { [T1]: [attachment('a1')] };
    const { unmount } = renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename spec.pdf' }));
    const input = screen.getByRole('textbox', { name: 'Rename spec.pdf' });
    await fireEvent.input(input, { target: { value: 'Scrapped' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    unmount();

    expect(patch).not.toHaveBeenCalled();
  });

  // The teardown flushes on every card dismissal that left a rename box open, so
  // without the guard merely opening the box costs a PATCH each time.
  it('writes nothing for an unchanged or retyped title', async () => {
    const patch = vi.spyOn(board, 'patchAttachment');
    board.taskAttachments = { [T1]: [attachment('a1', { title: 'The spec' })] };
    const untouched = renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename The spec' }));
    untouched.unmount();
    expect(patch).not.toHaveBeenCalled();

    renderSection();
    await fireEvent.click(screen.getByRole('button', { name: 'Rename The spec' }));
    const input = screen.getByRole('textbox', { name: 'Rename The spec' });
    await fireEvent.input(input, { target: { value: 'Something else' } });
    await fireEvent.input(input, { target: { value: '  The spec  ' } });
    await fireEvent.blur(input);

    expect(patch).not.toHaveBeenCalled();
  });

  it('clears a title emptied in the box rather than storing an empty string', async () => {
    const patch = vi.spyOn(board, 'patchAttachment');
    board.taskAttachments = { [T1]: [attachment('a1', { title: 'The spec' })] };
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename The spec' }));
    const input = screen.getByRole('textbox', { name: 'Rename The spec' });
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.blur(input);

    expect(patch).toHaveBeenCalledWith(T1, testUuid('a1'), { title: null });
  });

  it('requires two clicks to delete', async () => {
    board.taskAttachments = { [T1]: [attachment('a1')] };
    renderSection();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete spec.pdf' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete of spec.pdf' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestAt(0).url).toContain(`/api/attachments/${testUuid('a1')}`);
    expect(board.taskAttachments[T1]).toHaveLength(0);
  });
});
