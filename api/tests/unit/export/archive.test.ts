import { describe, it, expect } from 'vitest';
import { exportFilename, projectExportArchive } from '../../../src/services/export/archive';
import type { ExportAttachmentRow } from '../../../src/services/export/payload';
import { ZIP_MAX_ENTRIES } from '../../../src/services/export/zip';
import { AppError } from '../../../src/utils/errors';
import type { ProjectExport } from '../../../src/schemas/index';

const NOW = new Date('2026-07-26T13:45:30.000Z');

const EXPORT: ProjectExport = {
  format: 'critical-path-project-export',
  version: 1,
  exported_at: NOW.toISOString(),
  project: {
    id: 'p1',
    name: 'Project',
    description: '',
    archived_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    created_by: 'u1',
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
  },
  users: [],
  columns: [],
  labels: [],
  tasks: [],
};

describe('exportFilename', () => {
  it('slugifies the name and appends the export date', () => {
    expect(exportFilename('My Project! 🎉', NOW)).toBe('my-project-2026-07-26.zip');
  });

  it('collapses separator runs and trims the ends', () => {
    expect(exportFilename('  --Alpha // Beta--  ', NOW)).toBe('alpha-beta-2026-07-26.zip');
  });

  it('falls back to project when nothing survives slugification', () => {
    expect(exportFilename('🎉', NOW)).toBe('project-2026-07-26.zip');
    expect(exportFilename('!!! ???', NOW)).toBe('project-2026-07-26.zip');
  });

  it('truncates a long name to 60 characters', () => {
    expect(exportFilename('a'.repeat(80), NOW)).toBe(`${'a'.repeat(60)}-2026-07-26.zip`);
  });

  it('trims the hyphen that truncation can leave behind', () => {
    expect(exportFilename(`${'a'.repeat(59)} ${'b'.repeat(20)}`, NOW)).toBe(
      `${'a'.repeat(59)}-2026-07-26.zip`
    );
  });
});

// Images and files are the same row now, so one builder covers both; the prefix
// only keeps their generated paths distinct.
function attachmentRows(count: number, sizeBytes = 0, prefix = 'a'): ExportAttachmentRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `${prefix}${index}`,
    task_id: 't1',
    storage_key: `${prefix}k${index}`,
    path: `attachments/${prefix}${index}.pdf`,
    size_bytes: sizeBytes,
  }));
}

function refusal(attachments: ExportAttachmentRow[]): AppError {
  try {
    projectExportArchive(EXPORT, attachments, NOW);
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected projectExportArchive to refuse');
}

describe('projectExportArchive', () => {
  it('accepts an entry count that exactly fills the 16-bit count field', () => {
    // The manifest and the csv take two of the slots.
    expect(projectExportArchive(EXPORT, attachmentRows(ZIP_MAX_ENTRIES - 2), NOW)).toBeInstanceOf(
      ReadableStream
    );
  });

  it('refuses one entry beyond the 16-bit count field', () => {
    const error = refusal(attachmentRows(ZIP_MAX_ENTRIES - 1));
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(413);
  });

  it('refuses an archive whose bytes would overflow the 32-bit size fields', () => {
    const error = refusal(attachmentRows(3, 2_000_000_000));
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(413);
  });

  it('points the refusal at the json format and at the endpoints serving bytes', () => {
    const error = refusal(attachmentRows(3, 2_000_000_000));
    expect(error.message).toContain('format=json');
    expect(error.message).toContain('/api/images/');
    expect(error.message).toContain('/api/attachments/');
  });

  it('counts every kind toward the 16-bit entry count', () => {
    expect(
      projectExportArchive(
        EXPORT,
        [...attachmentRows(10, 0, 'i'), ...attachmentRows(ZIP_MAX_ENTRIES - 12)],
        NOW
      )
    ).toBeInstanceOf(ReadableStream);

    const error = refusal([...attachmentRows(10, 0, 'i'), ...attachmentRows(ZIP_MAX_ENTRIES - 11)]);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(413);
  });
});
