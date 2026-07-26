import { run } from './run';

function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write('', () => resolve()));
}

const code = await run(
  {
    env: process.env,
    platform: process.platform,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
  process.argv
);

// A socket still waiting on a connect keeps the event loop alive for undici's own 10s
// timeout long after the command has finished, and a TAB press must not wait on that.
// Flush first: exiting mid-write truncates a piped stdout.
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
