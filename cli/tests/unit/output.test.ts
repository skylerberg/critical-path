import { describe, it, expect } from 'vitest';
import { Output, formatTable, type Writer } from '../../src/output';

class BufferWriter implements Writer {
  text = '';
  write(chunk: string): void {
    this.text += chunk;
  }
}

function makeOutput(options: { json?: boolean; color?: boolean } = {}) {
  const stdout = new BufferWriter();
  const stderr = new BufferWriter();
  const out = new Output({
    stdout,
    stderr,
    json: options.json ?? false,
    color: options.color ?? false,
  });
  return { out, stdout, stderr };
}

describe('formatTable', () => {
  it('aligns columns and trims trailing whitespace', () => {
    const table = formatTable(
      ['ID', 'NAME'],
      [
        ['ab12', 'Fix the bug'],
        ['cd', 'X'],
      ]
    );
    expect(table).toBe(['ID    NAME', 'ab12  Fix the bug', 'cd    X'].join('\n'));
  });

  it('handles rows with missing cells', () => {
    expect(formatTable(['A', 'B'], [['only']])).toBe(['A     B', 'only'].join('\n'));
  });
});

describe('Output', () => {
  it('writes JSON when json mode is on', () => {
    const { out, stdout } = makeOutput({ json: true });
    out.data({ a: 1 }, () => out.line('human'));
    expect(JSON.parse(stdout.text)).toEqual({ a: 1 });
    expect(stdout.text).not.toContain('human');
  });

  it('writes the human rendering when json mode is off', () => {
    const { out, stdout } = makeOutput();
    out.data({ a: 1 }, () => out.line('human'));
    expect(stdout.text).toBe('human\n');
  });

  it('routes errors to stderr', () => {
    const { out, stdout, stderr } = makeOutput();
    out.error('boom');
    expect(stderr.text).toBe('boom\n');
    expect(stdout.text).toBe('');
  });

  it('passes text through unchanged when color is off', () => {
    const { out } = makeOutput({ color: false });
    expect(out.style(['red'], 'text')).toBe('text');
  });

  it('applies ANSI styles when color is on', () => {
    const { out } = makeOutput({ color: true });
    expect(out.style(['red'], 'text')).toContain('[');
  });
});
