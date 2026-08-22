import { writeFile } from 'fs/promises';
import path from 'path';
import { buildOpenApiSpec } from '../src/index';
import { db } from '../src/db/index';

// No --env-file: the spec is generated from the route declarations alone. The
// app imported above builds a pg Pool out of env defaults and never connects
// it, so the bytes written here do not depend on a .env — and requiring one
// made both client generators unrunnable in CI and in a fresh clone.

const spec = await buildOpenApiSpec();
const outPath = path.resolve('openapi.json');
await writeFile(outPath, JSON.stringify(spec, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
await db.destroy();
