import { run } from './run';

process.exitCode = await run(
  {
    env: process.env,
    platform: process.platform,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
  process.argv
);
