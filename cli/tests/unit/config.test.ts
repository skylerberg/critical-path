import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, saveConfig, resolveConfigDir, configPath } from '../../src/config';
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
