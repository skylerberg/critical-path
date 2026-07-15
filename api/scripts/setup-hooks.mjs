import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// No-op when .git is absent (e.g. CI runs npm ci on a checkout without hooks).
if (existsSync('.git')) {
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
}
