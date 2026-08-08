import { writeFile } from 'fs/promises';
import path from 'path';
import { buildRealtimeEventsDocument } from '../src/services/realtime/document';

const outPath = path.resolve('realtime-events.json');
await writeFile(outPath, JSON.stringify(await buildRealtimeEventsDocument(), null, 2) + '\n');
console.log(`Wrote ${outPath}`);
