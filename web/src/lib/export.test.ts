import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { downloadAccountExport, downloadProjectExport } from './export';
import { session } from './session.svelte';

const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:fake-url');
const revokeObjectURL = vi.fn();
// `connected` is read at click time: a click on an anchor that was never appended
// is ignored by some engines, and the after-the-fact `a[download]` null check
// cannot tell that apart from a clean removal.
let clicks: { anchor: HTMLAnchorElement; connected: boolean }[] = [];

function savedBlob(): Blob {
  const blob = createObjectURL.mock.calls[0]?.[0];
  if (blob === undefined) throw new Error('nothing was saved');
  return blob;
}

const ZIP_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

// The bytes go in raw: jsdom's Blob is not the one Node's Response recognises,
// so wrapping them in one makes the body the string "[object Blob]".
function zipResponse(headers: Record<string, string> = {}): Response {
  return new Response(ZIP_SIGNATURE, {
    status: 200,
    headers: { 'Content-Type': 'application/zip', ...headers },
  });
}

async function settleRevoke(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clicks = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push({ anchor: this, connected: this.isConnected });
  });
  session.adopt('test-token', {
    id: 'u1',
    email: 'a@example.com',
    name: 'A',
    avatar_url: null,
    email_verified: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadProjectExport', () => {
  it('saves the archive under the filename the server sent', async () => {
    fetchMock.mockResolvedValueOnce(
      zipResponse({ 'Content-Disposition': 'attachment; filename="game-2026-07-26.zip"' })
    );

    await expect(downloadProjectExport('p1')).resolves.toBe('zip');

    const request = requestAt(0);
    expect(request.url).toMatch(/\/api\/projects\/p1\/export$/);
    expect(request.method).toBe('GET');
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await savedBlob().arrayBuffer())).toEqual(ZIP_SIGNATURE);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].anchor.download).toBe('game-2026-07-26.zip');
    expect(clicks[0].anchor.href).toBe('blob:fake-url');
    expect(clicks[0].connected).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();

    expect(revokeObjectURL).not.toHaveBeenCalled();
    await settleRevoke();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('falls back to a generic filename when the header is missing', async () => {
    fetchMock.mockResolvedValueOnce(zipResponse());

    await downloadProjectExport('p1');

    expect(clicks[0].anchor.download).toBe('critical-path-export.zip');
  });

  it('saves the manifest alone when the project is too large to package', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(413, { error: 'Too large; use format=json' }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { format: 'critical-path-project-export', version: 1 })
    );

    await expect(downloadProjectExport('p1')).resolves.toBe('json');

    expect(requestAt(1).url).toMatch(/\/api\/projects\/p1\/export\?format=json$/);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].anchor.download).toBe('critical-path-export.json');
    expect(JSON.parse(await savedBlob().text())).toEqual({
      format: 'critical-path-project-export',
      version: 1,
    });
  });

  it('rejects when the manifest fallback also fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(413, { error: 'Too large; use format=json' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal Server Error' }));

    const error = await downloadProjectExport('p1').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect(clicks).toHaveLength(0);
  });

  it('rejects without touching the DOM when the project is gone', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Project not found' }));

    const error = await downloadProjectExport('p1').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe('Project not found');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });

  it('cleans up the anchor and the object url even when the click throws', async () => {
    fetchMock.mockResolvedValueOnce(zipResponse());
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('navigation blocked');
    });

    await expect(downloadProjectExport('p1')).rejects.toThrow('navigation blocked');
    expect(document.querySelector('a[download]')).toBeNull();
    await settleRevoke();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});

describe('downloadAccountExport', () => {
  it('saves the manifest under the filename the server sent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ format: 'critical-path-account-export', version: 1 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="critical-path-account-2026-08-02.json"',
        },
      })
    );

    await downloadAccountExport();

    const request = requestAt(0);
    expect(request.url).toMatch(/\/api\/auth\/me\/export$/);
    expect(request.method).toBe('GET');
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await savedBlob().text())).toEqual({
      format: 'critical-path-account-export',
      version: 1,
    });
    expect(clicks).toHaveLength(1);
    expect(clicks[0].anchor.download).toBe('critical-path-account-2026-08-02.json');
    expect(clicks[0].connected).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
    await settleRevoke();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('falls back to a generic filename when the header is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { format: 'critical-path-account-export' }));

    await downloadAccountExport();

    expect(clicks[0].anchor.download).toBe('critical-path-account.json');
  });

  // Asking for a blob governs the success body only — a JSON error body is still
  // parsed, so the server's own wording survives and is what the page shows.
  it('rejects on a server error without touching the DOM', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal Server Error' }));

    const error = await downloadAccountExport().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toBe('Internal Server Error');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });

  it('cleans up the anchor and the object url even when the click throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { format: 'critical-path-account-export' }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('navigation blocked');
    });

    await expect(downloadAccountExport()).rejects.toThrow('navigation blocked');
    expect(document.querySelector('a[download]')).toBeNull();
    await settleRevoke();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
