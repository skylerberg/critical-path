import { api, assertOk } from '../api/client';

const FALLBACK_FILENAME = 'critical-path-export.zip';

function filenameFrom(response: Response): string {
  const disposition = response.headers.get('content-disposition');
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? FALLBACK_FILENAME;
}

export async function downloadProjectExport(projectId: string): Promise<void> {
  const result = await api.GET('/api/projects/{id}/export', {
    params: { path: { id: projectId } },
    parseAs: 'blob',
  });
  const blob = assertOk(result);

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filenameFrom(result.response);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
