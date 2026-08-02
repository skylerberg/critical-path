import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  loadConfig,
  normalizeWebUrl,
  saveConfig,
  resolveConfigDir,
  configPath,
} from '../../src/config';
import { CliError } from '../../src/api/errors';

describe('resolveConfigDir', () => {
  it('prefers CRITICAL_PATH_CONFIG_DIR', () => {
    expect(resolveConfigDir({ CRITICAL_PATH_CONFIG_DIR: '/custom', XDG_CONFIG_HOME: '/xdg' })).toBe(
      '/custom'
    );
  });

  it('falls back to XDG_CONFIG_HOME', () => {
    expect(resolveConfigDir({ XDG_CONFIG_HOME: '/xdg' })).toBe(join('/xdg', 'critical-path'));
  });

  it('defaults to ~/.config', () => {
    expect(resolveConfigDir({})).toBe(join(homedir(), '.config', 'critical-path'));
  });
});

describe('normalizeWebUrl', () => {
  function errorOf(value: string): CliError {
    try {
      normalizeWebUrl(value);
    } catch (err) {
      if (err instanceof CliError) return err;
      throw err;
    }
    throw new Error(`expected "${value}" to be rejected`);
  }

  it('keeps the origin and path, without a trailing slash to double up', () => {
    expect(normalizeWebUrl('https://cp.example.test')).toBe('https://cp.example.test');
    expect(normalizeWebUrl('https://cp.example.test/')).toBe('https://cp.example.test');
    expect(normalizeWebUrl('https://cp.example.test/boards//')).toBe(
      'https://cp.example.test/boards'
    );
    expect(normalizeWebUrl('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('rejects anything that is not an absolute http(s) URL', () => {
    for (const value of ['cp.example.test', '/boards', 'ftp://cp.example.test', 'not a url', '']) {
      expect(errorOf(value).exitCode).toBe(2);
    }
  });

  // Every one of these parses and every one produces a link that is broken, or
  // that carries the user's password to whoever the link is pasted to.
  it('rejects a query, a fragment and credentials', () => {
    for (const value of [
      'https://cp.example.test/?a=1',
      'https://cp.example.test/#frag',
      'https://user:pw@cp.example.test',
      'https://user@cp.example.test',
    ]) {
      const err = errorOf(value);
      expect(err.exitCode).toBe(2);
      expect(err.message).toContain('query, fragment or credentials');
    }
  });
});

describe('loadConfig / saveConfig', () => {
  it('returns an empty config when the file is missing', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'cpath-test-')), 'absent');
    expect(await loadConfig(dir)).toEqual({});
  });

  it('round-trips a saved config', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'cpath-test-')), 'cfg');
    await saveConfig(dir, { api_url: 'http://example.com', default_project: 'abc' });
    expect(await loadConfig(dir)).toEqual({
      api_url: 'http://example.com',
      default_project: 'abc',
    });
  });

  it('raises a CliError on invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cpath-test-'));
    await mkdir(dir, { recursive: true });
    await writeFile(configPath(dir), 'not json');
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(CliError);
  });
});
