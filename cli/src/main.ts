import { run } from './run';

function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write('', () => resolve()));
}

// Node ignores SIGPIPE, so a reader that goes away surfaces as an otherwise-fatal EPIPE
// error event. Bare `process.exit()` keeps whatever exit code was already computed.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    process.exit();
  }
});

const code = await run(
  {
    env: process.env,
    platform: process.platform,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    onInterrupt: (handler) => {
      // `once` so a second Ctrl-C kills by default disposition even if the first is swallowed.
      process.once('SIGINT', handler);
      process.once('SIGTERM', handler);
      return () => {
        process.off('SIGINT', handler);
        process.off('SIGTERM', handler);
      };
    },
  },
  process.argv
);

process.exitCode = code;
// A socket still waiting on a connect keeps the event loop alive for undici's own 10s
// timeout long after the command has finished, and a TAB press must not wait on that.
// Flush first: exiting mid-write truncates a piped stdout.
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
