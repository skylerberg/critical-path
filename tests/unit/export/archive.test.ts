import { describe, it, expect } from 'vitest';
import { exportFilename, projectExportArchive } from '../../../src/services/export/archive';
import type { ExportImageRow } from '../../../src/services/export/payload';
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

function imageRows(count: number, sizeBytes = 0): ExportImageRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `i${index}`,
    task_id: 't1',
    storage_key: `k${index}`,
    filename: `${index}.png`,
    content_type: 'image/png',
    size_bytes: sizeBytes,
    created_at: NOW,
  }));
}

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

function refusal(images: ExportImageRow[]): AppError {
  try {
    projectExportArchive(EXPORT, images, NOW);
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected projectExportArchive to refuse');
}

describe('projectExportArchive', () => {
  it('accepts an entry count that exactly fills the 16-bit count field', () => {
    // The manifest and the csv take two of the slots.
    expect(projectExportArchive(EXPORT, imageRows(ZIP_MAX_ENTRIES - 2), NOW)).toBeInstanceOf(
      ReadableStream
    );
  });

  it('refuses one entry beyond the 16-bit count field', () => {
    const error = refusal(imageRows(ZIP_MAX_ENTRIES - 1));
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(413);
  });

  it('refuses an archive whose bytes would overflow the 32-bit size fields', () => {
    const error = refusal(imageRows(3, 2_000_000_000));
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(413);
  });

  it('points the refusal at the json format and at the endpoint serving image bytes', () => {
    const error = refusal(imageRows(3, 2_000_000_000));
    expect(error.message).toContain('format=json');
    expect(error.message).toContain('/api/images/');
  });
});
