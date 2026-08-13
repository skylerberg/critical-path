import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimatedTaskCount, resolveScale, type Scale } from './config';
import {
  createBenchDatabase,
  databaseSizeBytes,
  dropBenchSchema,
  pointEnvAtBenchDatabase,
  readSeedMarker,
  tableSizes,
  writeSeedMarker,
} from './database';
import { formatBytes, formatMs, instrumentQueries, type QueryRecord } from './measure';
import { BenchClient, runScenario, type BenchContext, type ScenarioResult } from './harness';
import { benchClient, benchIds, BENCH_PASSWORD, seed, type BenchIds } from './seed';
import { scenarios } from './scenarios';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

interface Options {
  scale: Scale;
  reseed: boolean;
  only: string | null;
  explain: boolean;
}

function parseArgs(argv: string[]): Options {
  let scaleName: string | undefined;
  let reseed = false;
  let only: string | null = null;
  let explain = false;

  for (const arg of argv) {
    if (arg.startsWith('--scale=')) scaleName = arg.slice('--scale='.length);
    else if (arg === '--reseed') reseed = true;
    else if (arg.startsWith('--only=')) only = arg.slice('--only='.length);
    else if (arg === '--explain') explain = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: npm run bench -- [options]',
          '',
          '  --scale=fast|heavy   Dataset size (default fast).',
          '  --reseed             Drop and rebuild the dataset even if it looks current.',
          '  --only=<substring>   Run only scenarios whose name or group contains this.',
          '  --explain            Print the plan for the slowest statement of each scenario.',
        ].join('\n')
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument ${arg}. Try --help.`);
    }
  }

  return { scale: resolveScale(scaleName), reseed, only, explain };
}

// Covers the scale, the seeder itself and the migration set, so a changed
// seeder or a new migration rebuilds the dataset rather than benchmarking one
// that no longer matches the schema that produced it.
function seedFingerprint(scale: Scale): string {
  const seeder = readFileSync(join(here, 'seed.ts'), 'utf8');
  const migrations = readdirSync(join(repoRoot, 'src', 'db', 'migrations'))
    .sort()
    .join(',');
  return createHash('sha256')
    .update(`${scale.name} ${seeder} ${migrations}`)
    .digest('hex')
    .slice(0, 16);
}

function flagsFor(result: ScenarioResult): string[] {
  if (result.error !== undefined) return ['ERROR'];
  const flags: string[] = [];
  if (result.stats.p95 >= 1000) flags.push('SLOW');
  else if (result.stats.p95 >= 250) flags.push('WARN');
  if (result.queries >= 25) flags.push('QUERIES');
  if (result.bytes >= 2 * 1024 * 1024) flags.push('HUGE-PAYLOAD');
  else if (result.bytes >= 512 * 1024) flags.push('BIG-PAYLOAD');
  if (result.status >= 400) flags.push(`HTTP-${String(result.status)}`);
  return flags;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function collapse(sql: string): string {
  const single = sql.replace(/\s+/g, ' ').trim();
  return single.length > 320 ? `${single.slice(0, 320)}…` : single;
}

function printTable(title: string, results: ScenarioResult[]): void {
  if (results.length === 0) return;
  const nameWidth = Math.max(24, ...results.map((result) => result.name.length));
  const header =
    `${pad('scenario', nameWidth)}  ${padStart('code', 4)} ${padStart('p50', 8)} ${padStart('p95', 8)} ${padStart('max', 8)} ` +
    `${padStart('queries', 7)} ${padStart('db', 8)} ${padStart('payload', 9)}  flags`;

  console.log(`\n${title}`);
  console.log('─'.repeat(header.length));
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const result of results) {
    if (result.error !== undefined) {
      console.log(`${pad(result.name, nameWidth)}  ERROR ${result.error}`);
      continue;
    }
    console.log(
      `${pad(result.name, nameWidth)}  ${padStart(String(result.status), 4)} ${padStart(formatMs(result.stats.p50), 8)} ` +
        `${padStart(formatMs(result.stats.p95), 8)} ${padStart(formatMs(result.stats.max), 8)} ` +
        `${padStart(String(result.queries), 7)} ${padStart(formatMs(result.dbMs), 8)} ` +
        `${padStart(formatBytes(result.bytes), 9)}  ${flagsFor(result).join(' ')}`
    );
  }
}

function printDetails(results: ScenarioResult[]): void {
  const notable = results.filter(
    (result) => flagsFor(result).length > 0 || result.error !== undefined
  );
  if (notable.length === 0) {
    console.log('\nNothing crossed a threshold.');
    return;
  }

  console.log('\n\nFlagged scenarios');
  console.log('═'.repeat(78));
  for (const result of notable) {
    console.log(`\n${result.name}  [${flagsFor(result).join(' ')}]`);
    console.log(`  ${result.probe}`);
    if (result.error !== undefined) {
      console.log(`  error: ${result.error}`);
      continue;
    }
    console.log(
      `  p50 ${formatMs(result.stats.p50)} · p95 ${formatMs(result.stats.p95)} · ` +
        `max ${formatMs(result.stats.max)} · ${String(result.queries)} queries · ` +
        `${formatMs(result.dbMs)} in the database · ${formatBytes(result.bytes)} returned` +
        (result.note === undefined ? '' : ` · ${result.note}`)
    );
    if (result.slowest !== null) {
      const share = result.dbMs === 0 ? 0 : (result.slowest.ms / result.dbMs) * 100;
      console.log(
        `  slowest statement: ${formatMs(result.slowest.ms)} (${share.toFixed(0)}% of database time)`
      );
      console.log(`    ${collapse(result.slowest.text)}`);
    }
  }
}

async function explainSlowest(results: ScenarioResult[]): Promise<void> {
  // Only reads: EXPLAIN ANALYZE runs the statement, and re-running the write
  // paths outside their request transaction would leave rows behind.
  const explainable = results.filter(
    (result): result is ScenarioResult & { slowest: QueryRecord } =>
      result.slowest !== null && /^\s*(select|with)\b/i.test(result.slowest.text)
  );
  if (explainable.length === 0) return;

  console.log('\n\nPlans for the slowest statement of each scenario');
  console.log('═'.repeat(78));

  const client = await benchClient();
  try {
    for (const result of explainable) {
      console.log(`\n${result.name}`);
      try {
        const { rows } = await client.query<Record<string, string>>(
          `explain (analyze, buffers) ${result.slowest.text}`,
          result.slowest.values
        );
        for (const row of rows) {
          console.log(`  ${row['QUERY PLAN'] ?? ''}`);
        }
      } catch (error) {
        console.log(
          `  could not explain: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const database = pointEnvAtBenchDatabase(options.scale.name);
  console.log(`Critical Path benchmark · scale "${options.scale.name}" · database ${database}`);

  await createBenchDatabase();

  const fingerprint = seedFingerprint(options.scale);
  const stale = options.reseed || (await readSeedMarker()) !== fingerprint;

  // Before the app is imported, never after: src/db reads DB_DATABASE at module
  // scope and opens its pool immediately, so a schema dropped later would leave
  // that pool pointed at tables that no longer exist.
  if (stale) {
    console.log('Dataset is missing or stale — rebuilding.');
    await dropBenchSchema();
  }

  const { db } = await import('../src/db/index');
  const { runMigrations } = await import('../src/db/migrate');
  const { app } = await import('../src/index');
  const { resetRateLimiter } = await import('../src/services/rateLimit');

  let ids: BenchIds;
  if (stale) {
    const migration = await runMigrations(db);
    if (migration.error) {
      throw migration.error instanceof Error ? migration.error : new Error(String(migration.error));
    }

    console.log(
      `Seeding ~${estimatedTaskCount(options.scale).toLocaleString()} cards. This runs once per ` +
        'scale; later runs reuse it.'
    );
    // The one place a real hash is computed: every seeded account shares it, so
    // the login benchmark still measures argon2 rather than a stub.
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash(BENCH_PASSWORD);

    const started = performance.now();
    ids = await seed(options.scale, passwordHash, (step) => console.log(`  ${step}`));
    console.log(`Seeded in ${formatMs(performance.now() - started)}.`);
    await writeSeedMarker(fingerprint);
  } else {
    console.log('Dataset is current; skipping the seed.');
    ids = benchIds(options.scale);
  }

  console.log(`Database size: ${formatBytes(await databaseSizeBytes())}`);

  instrumentQueries();

  const ctx: BenchContext = {
    ids,
    scale: options.scale,
    db,
    as: (token?: string) => new BenchClient(app, token),
  };

  const needle = options.only?.toLowerCase();
  const selected =
    needle === undefined
      ? scenarios
      : scenarios.filter(
          (scenario) =>
            scenario.name.toLowerCase().includes(needle) ||
            scenario.group.toLowerCase().includes(needle)
        );

  if (selected.length === 0) {
    throw new Error(`No scenario matched --only=${String(options.only)}`);
  }

  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    process.stdout.write(`\rrunning: ${pad(scenario.name, 60)}`);
    results.push(await runScenario(scenario, ctx, resetRateLimiter));
  }
  process.stdout.write(`\r${' '.repeat(72)}\r`);

  for (const group of ['read', 'write', 'pathological']) {
    printTable(
      group.toUpperCase(),
      results.filter((result) => result.group === group)
    );
  }

  printDetails(results);

  if (options.explain) {
    await explainSlowest(results);
  }

  console.log('\n\nLargest tables');
  console.log('═'.repeat(78));
  for (const table of await tableSizes()) {
    console.log(
      `  ${pad(table.table, 28)} ${padStart(table.rows.toLocaleString(), 12)} rows  ` +
        `${padStart(formatBytes(table.bytes), 9)}`
    );
  }

  await db.destroy();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
