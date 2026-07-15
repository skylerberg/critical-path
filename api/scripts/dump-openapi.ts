import { writeFile } from 'fs/promises';
import path from 'path';
import { buildOpenApiSpec } from '../src/index';
import { db } from '../src/db/index';

const spec = await buildOpenApiSpec();
const outPath = path.resolve('openapi.json');
await writeFile(outPath, JSON.stringify(spec, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
await db.destroy();
