import {
  dropTestDatabases,
  isAbandoned,
  listTestDatabases,
  type TestDatabase,
} from '../tests/setup/testDatabase';
import { resolveTestDatabaseName } from '../tests/setup/testDatabaseName';

const dropLegacy = process.argv.includes('--legacy');

function megabytes(databases: TestDatabase[]): string {
  const bytes = databases.reduce((total, database) => total + database.bytes, 0);
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function report(label: string, databases: TestDatabase[]): void {
  console.log(`\n${label} (${databases.length}, ${megabytes(databases)}):`);
  for (const database of databases) {
    console.log(`  ${database.name}${database.checkout ? `  ← ${database.checkout}` : ''}`);
  }
}

const databases = await listTestDatabases();
const current = resolveTestDatabaseName();
const abandoned = databases.filter(
  (database) => database.name !== current && isAbandoned(database)
);
// Databases from before per-checkout naming, or from another tool: they carry
// no checkout to check, so removing them is never automatic.
const legacy = databases.filter((database) => database.checkout === null);

if (abandoned.length > 0) {
  report('Abandoned (checkout no longer exists)', abandoned);
  const dropped = await dropTestDatabases(abandoned.map((database) => database.name));
  console.log(`\nDropped ${dropped.length} of ${abandoned.length}; any skipped one is in use.`);
} else {
  console.log('No abandoned test databases.');
}

if (legacy.length > 0) {
  report('Unclaimed by any checkout', legacy);
  if (dropLegacy) {
    const dropped = await dropTestDatabases(legacy.map((database) => database.name));
    console.log(`\nDropped ${dropped.length} of ${legacy.length}; any skipped one is in use.`);
  } else {
    console.log('\nRe-run with --legacy to drop these.');
  }
}
