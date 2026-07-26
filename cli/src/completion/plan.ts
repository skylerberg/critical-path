import type { Argument, Command, Option } from 'commander';

export interface Candidate {
  value: string;
  description: string;
}

export type ValueKind = 'project' | 'task' | 'column' | 'label' | 'user' | 'path';

export type CompletionPlan =
  | { kind: 'none' }
  | { kind: 'files' }
  | { kind: 'static'; items: Candidate[] }
  | { kind: 'values'; valueKind: Exclude<ValueKind, 'path'>; projectRef?: string };

// Keyed by the placeholder that already appears in --help, so new commands reusing
// a placeholder get completion without this table being touched.
const VALUE_KINDS: Record<string, ValueKind> = {
  project: 'project',
  task: 'task',
  column: 'column',
  label: 'label',
  labels: 'label',
  user: 'user',
  users: 'user',
  file: 'path',
  path: 'path',
};

const FILES_SENTINEL = ':files';

export function dequoteWord(word: string): string {
  if (word.startsWith("'")) {
    return word.replace(/^'/, '').replace(/'$/, '');
  }
  if (word.startsWith('"')) {
    return word.replace(/^"/, '').replace(/"$/, '');
  }
  return word.replace(/\\(.)/g, '$1');
}

export function currentWord(words: string[]): string {
  return dequoteWord(words[words.length - 1] ?? '');
}

function findOption(cmd: Command, flag: string): Option | undefined {
  return cmd.options.find((option) => option.long === flag || option.short === flag);
}

function takesValue(option: Option): boolean {
  return option.required || option.optional || option.variadic;
}

function optionPlaceholder(option: Option): string | undefined {
  const match = /[<[]([^>\]]+)[>\]]/.exec(option.flags);
  return match?.[1].replace(/\.\.\.$/, '');
}

function staticFromChoices(choices: string[]): CompletionPlan {
  return { kind: 'static', items: choices.map((value) => ({ value, description: '' })) };
}

function planForPlaceholder(placeholder: string | undefined, projectRef?: string): CompletionPlan {
  const valueKind = placeholder == null ? undefined : VALUE_KINDS[placeholder];
  if (valueKind == null) {
    return { kind: 'none' };
  }
  if (valueKind === 'path') {
    return { kind: 'files' };
  }
  return projectRef == null
    ? { kind: 'values', valueKind }
    : { kind: 'values', valueKind, projectRef };
}

function planForOption(option: Option, projectRef?: string): CompletionPlan {
  if (option.argChoices != null) {
    return staticFromChoices(option.argChoices);
  }
  return planForPlaceholder(optionPlaceholder(option), projectRef);
}

function planForArgument(argument: Argument | undefined, projectRef?: string): CompletionPlan {
  if (argument == null) {
    return { kind: 'none' };
  }
  if (argument.argChoices != null) {
    return staticFromChoices(argument.argChoices);
  }
  return planForPlaceholder(argument.name(), projectRef);
}

function argumentAt(cmd: Command, index: number): Argument | undefined {
  const args = cmd.registeredArguments;
  if (index < args.length) {
    return args[index];
  }
  const last = args[args.length - 1];
  return last?.variadic === true ? last : undefined;
}

export function planCompletion(program: Command, words: string[]): CompletionPlan {
  if (words.length === 0) {
    return { kind: 'none' };
  }
  const dequoted = words.map(dequoteWord);
  const current = dequoted[dequoted.length - 1];

  let cmd = program;
  let positionals = 0;
  let pendingOption: Option | null = null;
  let projectRef: string | undefined;

  for (const word of dequoted.slice(1, -1)) {
    if (pendingOption != null) {
      // bash 4/5 splits `--project=x` on COMP_WORDBREAKS into three words.
      if (word === '=') {
        continue;
      }
      if (pendingOption.long === '--project') {
        projectRef = word;
      }
      pendingOption = null;
      continue;
    }
    if (word.startsWith('-')) {
      const eq = word.indexOf('=');
      if (eq !== -1) {
        if (word.slice(0, eq) === '--project') {
          projectRef = word.slice(eq + 1);
        }
        continue;
      }
      const option = findOption(cmd, word);
      if (option != null && takesValue(option)) {
        pendingOption = option;
      }
      continue;
    }
    const sub = cmd.commands.find((c) => c.name() === word || c.aliases().includes(word));
    if (sub != null) {
      cmd = sub;
      positionals = 0;
      continue;
    }
    positionals += 1;
  }

  if (pendingOption != null) {
    return planForOption(pendingOption, projectRef);
  }

  const helper = program.createHelp();

  if (current.startsWith('-')) {
    if (current.includes('=')) {
      return { kind: 'none' };
    }
    return {
      kind: 'static',
      items: helper.visibleOptions(cmd).flatMap((option) => {
        const value = option.long ?? option.short;
        return value == null ? [] : [{ value, description: helper.optionDescription(option) }];
      }),
    };
  }

  if (cmd.commands.length > 0 && positionals === 0) {
    return {
      kind: 'static',
      items: helper.visibleCommands(cmd).map((sub) => ({
        value: sub.name(),
        description: helper.subcommandDescription(sub),
      })),
    };
  }

  return planForArgument(argumentAt(cmd, positionals), projectRef);
}

export function filterCandidates(items: Candidate[], current: string): Candidate[] {
  const prefix = current.toLowerCase();
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.value.toLowerCase().startsWith(prefix) || seen.has(item.value)) {
      return false;
    }
    seen.add(item.value);
    return true;
  });
}

function isControl(char: string): boolean {
  return char.charCodeAt(0) < 0x20;
}

// Tabs and newlines separate the fields of the wire format, so a value carrying one
// cannot round-trip and is dropped rather than silently truncated.
function usable(value: string): boolean {
  return value !== '' && value !== FILES_SENTINEL && ![...value].some(isControl);
}

function sanitize(description: string): string {
  return [...description]
    .map((char) => (isControl(char) ? ' ' : char))
    .join('')
    .trim();
}

export function formatCandidates(items: Candidate[]): string {
  return items
    .filter((item) => usable(item.value))
    .map((item) => `${item.value}\t${sanitize(item.description)}\n`)
    .join('');
}
