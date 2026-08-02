import { styleText } from 'node:util';

export interface Writer {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

type Style = Parameters<typeof styleText>[0];

export const TITLE_DISPLAY_LIMIT = 500;

// Scanning output caps titles far below the stored bound; surfaces whose job is
// to show one title in full, and every machine-readable one, skip this.
export function displayTitle(title: string): string {
  if (title.length <= TITLE_DISPLAY_LIMIT) {
    return title;
  }
  const points = [...title];
  return points.length <= TITLE_DISPLAY_LIMIT
    ? title
    : `${points.slice(0, TITLE_DISPLAY_LIMIT).join('').trimEnd()}…`;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length))
  );
  const format = (cells: string[]): string =>
    cells
      .map((cell, i) => (i === widths.length - 1 ? (cell ?? '') : (cell ?? '').padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [format(headers), ...rows.map(format)].join('\n');
}

export class Output {
  readonly json: boolean;
  #stdout: Writer;
  #stderr: Writer;
  #color: boolean;

  constructor(options: { stdout: Writer; stderr: Writer; json: boolean; color: boolean }) {
    this.#stdout = options.stdout;
    this.#stderr = options.stderr;
    this.json = options.json;
    this.#color = options.color;
  }

  line(text = ''): void {
    this.#stdout.write(`${text}\n`);
  }

  error(text: string): void {
    this.#stderr.write(`${text}\n`);
  }

  data(value: unknown, human: () => void): void {
    if (this.json) {
      this.line(JSON.stringify(value, null, 2));
    } else {
      human();
    }
  }

  table(headers: string[], rows: string[][]): void {
    this.line(formatTable(headers, rows));
  }

  style(style: Style, text: string): string {
    return this.#color ? styleText(style, text, { validateStream: false }) : text;
  }
}
