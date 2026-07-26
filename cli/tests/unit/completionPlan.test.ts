import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { buildProgram } from '../../src/program';
import {
  currentWord,
  dequoteWord,
  filterCandidates,
  formatCandidates,
  planCompletion,
  type Candidate,
  type CompletionPlan,
} from '../../src/completion/plan';
import type { CliDeps } from '../../src/context';

const deps: CliDeps = {
  env: {},
  platform: 'linux',
  stdin: new PassThrough(),
  stdout: { write: () => true },
  stderr: { write: () => true },
};

const program = buildProgram(deps);

function plan(words: string[]): CompletionPlan {
  return planCompletion(program, words);
}

function values(words: string[]): string[] {
  const result = plan(words);
  if (result.kind !== 'static') {
    throw new Error(`expected static candidates, got ${result.kind}`);
  }
  return result.items.map((item) => item.value);
}

describe('planCompletion: subcommands', () => {
  it('offers the top-level commands', () => {
    expect(values(['cpath', ''])).toEqual(
      expect.arrayContaining(['login', 'project', 'task', 'board', 'config', 'completion', 'help'])
    );
  });

  it('never offers the hidden __complete command', () => {
    expect(values(['cpath', ''])).not.toContain('__complete');
  });

  it('offers a group’s subcommands', () => {
    expect(values(['cpath', 'task', ''])).toEqual(
      expect.arrayContaining(['list', 'create', 'label', 'assignees', 'blockers'])
    );
  });

  it('walks into a nested group', () => {
    expect(values(['cpath', 'task', 'label', ''])).toEqual(
      expect.arrayContaining(['add', 'remove', 'set'])
    );
  });
});

describe('planCompletion: flags', () => {
  it('offers the flags of the command on the line', () => {
    expect(values(['cpath', 'task', 'list', '--'])).toEqual(
      expect.arrayContaining([
        '--project',
        '--column',
        '--label',
        '--assignee',
        '--ready',
        '--json',
        '--no-input',
        '--help',
      ])
    );
  });

  it('offers a flag’s declared choices', () => {
    expect(values(['cpath', 'completion', '-s', ''])).toEqual(['bash', 'zsh', 'fish']);
  });

  it('gives up on a half-typed --flag=value', () => {
    expect(plan(['cpath', 'task', 'list', '--project=Col'])).toEqual({ kind: 'none' });
  });
});

describe('planCompletion: entity values', () => {
  it('resolves an option placeholder to its value kind', () => {
    expect(plan(['cpath', 'task', 'list', '--column', ''])).toEqual({
      kind: 'values',
      valueKind: 'column',
    });
  });

  it('carries the project named on the line', () => {
    expect(plan(['cpath', 'task', 'list', '--project', 'Colori', '--column', ''])).toEqual({
      kind: 'values',
      valueKind: 'column',
      projectRef: 'Colori',
    });
  });

  it('carries the project from the inline = form', () => {
    expect(plan(['cpath', 'task', 'list', '--project=Colori', '--label', ''])).toEqual({
      kind: 'values',
      valueKind: 'label',
      projectRef: 'Colori',
    });
  });

  it('dequotes a project carried by the inline = form', () => {
    for (const word of ["--project='My Project'", '--project="My Project"']) {
      expect(plan(['cpath', 'task', 'list', word, '--column', ''])).toEqual({
        kind: 'values',
        valueKind: 'column',
        projectRef: 'My Project',
      });
    }
  });

  it('carries the project from the bash word-broken = form', () => {
    expect(plan(['cpath', 'task', 'list', '--project', '=', 'Colori', '--label', ''])).toEqual({
      kind: 'values',
      valueKind: 'label',
      projectRef: 'Colori',
    });
  });

  it('completes tasks after --by', () => {
    expect(plan(['cpath', 'task', 'block', 'Ship it', '--by', ''])).toEqual({
      kind: 'values',
      valueKind: 'task',
    });
  });

  it('completes an optional positional', () => {
    expect(plan(['cpath', 'board', ''])).toEqual({ kind: 'values', valueKind: 'project' });
  });

  it('keeps completing past the end of a variadic positional', () => {
    expect(plan(['cpath', 'project', 'set-members', 'Colori', 'a@b.c', ''])).toEqual({
      kind: 'values',
      valueKind: 'user',
      projectRef: 'Colori',
    });
  });

  it('carries a project named as a positional', () => {
    expect(plan(['cpath', 'project', 'set-members', "'My Project'", ''])).toEqual({
      kind: 'values',
      valueKind: 'user',
      projectRef: 'My Project',
    });
  });

  it('completes the second positional of a command', () => {
    expect(plan(['cpath', 'task', 'label', 'add', 'Ship it', ''])).toEqual({
      kind: 'values',
      valueKind: 'label',
    });
  });
});

describe('planCompletion: paths and dead ends', () => {
  it('asks for file completion on a path positional', () => {
    expect(plan(['cpath', 'image', 'upload', 'Ship it', ''])).toEqual({ kind: 'files' });
  });

  it('asks for file completion on a path option', () => {
    expect(plan(['cpath', 'task', 'create', 'x', '--description-file', ''])).toEqual({
      kind: 'files',
    });
  });

  it('offers nothing for a free-text positional', () => {
    expect(plan(['cpath', 'config', 'set', ''])).toEqual({ kind: 'none' });
    expect(plan(['cpath', 'column', 'create', ''])).toEqual({ kind: 'none' });
  });

  it('does not fall through to files for an option with no value kind', () => {
    expect(plan(['cpath', 'task', 'list', '--api-url', ''])).toEqual({ kind: 'none' });
  });

  it('offers nothing for an empty command line', () => {
    expect(plan([])).toEqual({ kind: 'none' });
  });
});

describe('dequoteWord', () => {
  it('strips the quoting forms bash and zsh hand back', () => {
    expect(dequoteWord("'My Project'")).toBe('My Project');
    expect(dequoteWord('"My Project"')).toBe('My Project');
    expect(dequoteWord('My\\ Project')).toBe('My Project');
    expect(dequoteWord('plain')).toBe('plain');
  });

  it('dequotes a project ref before it is resolved', () => {
    expect(plan(['cpath', 'task', 'list', '--project', "'My Project'", '--column', ''])).toEqual({
      kind: 'values',
      valueKind: 'column',
      projectRef: 'My Project',
    });
  });

  it('dequotes the word being completed', () => {
    expect(currentWord(['cpath', 'task', 'show', 'Fix\\ the'])).toBe('Fix the');
  });
});

describe('filterCandidates', () => {
  const items: Candidate[] = [
    { value: 'Backlog', description: 'a' },
    { value: 'blocked', description: 'b' },
    { value: 'Done', description: 'c' },
    { value: 'Backlog', description: 'd' },
  ];

  it('matches a prefix case-insensitively and keeps input order', () => {
    expect(filterCandidates(items, 'b').map((i) => i.value)).toEqual(['Backlog', 'blocked']);
  });

  it('drops later duplicates', () => {
    expect(filterCandidates(items, '')).toHaveLength(3);
  });
});

describe('formatCandidates', () => {
  it('emits one newline-terminated value/description pair per line', () => {
    expect(formatCandidates([{ value: 'Backlog', description: 'abcd1234' }])).toBe(
      'Backlog\tabcd1234\n'
    );
  });

  it('emits an empty description as a bare trailing tab', () => {
    expect(formatCandidates([{ value: 'bash', description: '' }])).toBe('bash\t\n');
  });

  it('drops values that cannot round-trip through the wire format', () => {
    expect(
      formatCandidates([
        { value: '', description: 'empty' },
        { value: 'two\nlines', description: '' },
        { value: 'has\ttab', description: '' },
        { value: ':files', description: 'would be read as the sentinel' },
        { value: 'ok', description: '' },
      ])
    ).toBe('ok\t\n');
  });

  it('flattens a multi-line description onto its line', () => {
    expect(formatCandidates([{ value: 'ok', description: 'one\ttwo\nthree' }])).toBe(
      'ok\tone two three\n'
    );
  });
});
