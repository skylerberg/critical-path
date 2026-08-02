import { ApiError, api, assertOk } from '../api/client';

const FALLBACK_ARCHIVE_FILENAME = 'critical-path-export.zip';
const FALLBACK_MANIFEST_FILENAME = 'critical-path-export.json';
const FALLBACK_ACCOUNT_FILENAME = 'critical-path-account.json';

export type ExportedFormat = 'zip' | 'json';

function filenameFrom(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition');
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? fallback;
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Revoking in the same task as the click can invalidate the url before the
    // browser has read the blob, which silently drops the download.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }
}

async function fetchExport(
  projectId: string,
  format?: 'json'
): Promise<{ blob: Blob; response: Response }> {
  const result = await api.GET('/api/projects/{id}/export', {
    params: { path: { id: projectId }, query: format === undefined ? undefined : { format } },
    parseAs: 'blob',
  });
  return { blob: assertOk(result), response: result.response };
}

// 413 means the images are too big to package, and the manifest is then the
// only way to get the data out.
export async function downloadProjectExport(projectId: string): Promise<ExportedFormat> {
  try {
    const { blob, response } = await fetchExport(projectId);
    save(blob, filenameFrom(response, FALLBACK_ARCHIVE_FILENAME));
    return 'zip';
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 413) {
      throw error;
    }
  }

  const { blob, response } = await fetchExport(projectId, 'json');
  save(blob, filenameFrom(response, FALLBACK_MANIFEST_FILENAME));
  return 'json';
}

export async function downloadAccountExport(): Promise<void> {
  const result = await api.GET('/api/auth/me/export', { parseAs: 'blob' });
  const blob = assertOk(result);
  save(blob, filenameFrom(result.response, FALLBACK_ACCOUNT_FILENAME));
}
