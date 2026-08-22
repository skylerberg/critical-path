// Where the repository is, answered once for every generator in it.
//
// Resolved from this file's own URL, never from the caller's: the two packages
// that import it sit at different depths, and cwd is whatever directory pnpm
// happened to run the script from. This file is at scripts/lib/, so the root is
// two levels up and stays two levels up no matter who imports it.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The api package produces both generated documents. Nothing searches for it and
// nothing may override it: one commit now holds both sides of every schema
// change, so the api sources in this working tree are the only ones a client in
// this repository should ever be generated from.
export const API_DIR = resolve(REPO_ROOT, 'api');

// What a generated header is labeled with. Repo-relative and constant, so a
// committed header records which package answered rather than one machine's
// checkout path — and so a header naming a URL instead is visible at a glance.
export const API_LABEL = 'api';
