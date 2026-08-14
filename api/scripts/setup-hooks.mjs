import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// No-op when .git is absent (e.g. CI runs pnpm install --frozen-lockfile on a checkout without hooks).
if (existsSync('.git')) {
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
}
