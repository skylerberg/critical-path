import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
  {
    ignores: [
      'dist/',
      'dev-dist/',
      'coverage/',
      // Linked worktrees parked under the repo look like extra source trees to a
      // scan launched from the main checkout (and their own tsconfig.json breaks
      // tsconfigRootDir auto-detection). Ignore them.
      '.pi/worktrees/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
      // Pin the root so typescript-eslint doesn't auto-detect multiple
      // candidates when linked worktrees (each with their own tsconfig.json)
      // are checked out under the repo.
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  }
);
