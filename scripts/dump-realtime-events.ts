import { writeFile } from 'fs/promises';
import path from 'path';
import { buildRealtimeEventsDocument } from '../src/services/realtime/document';

// No --env-file, unlike dump-openapi: the document is built from the two
// declaration tables alone and reads neither the database nor a config value,
// so requiring a .env only made this fail in a fresh worktree for no reason.

const outPath = path.resolve('realtime-events.json');
await writeFile(outPath, JSON.stringify(await buildRealtimeEventsDocument(), null, 2) + '\n');
console.log(`Wrote ${outPath}`);
