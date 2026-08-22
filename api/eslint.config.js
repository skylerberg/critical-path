import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import noUnqualifiedKyselyColumns from './eslint-rules/no-unqualified-kysely-columns.js';

export default tseslint.config(
  // The lint script is `eslint .`, so a directory this package grows is covered
  // without anyone widening an argument list. Build output is what a bare `.`
  // sweeps in and this sweeps back out; node_modules is eslint's own default.
  { ignores: ['dist/', 'coverage/', 'data/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      local: {
        rules: {
          'no-unqualified-kysely-columns': noUnqualifiedKyselyColumns,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      'local/no-unqualified-kysely-columns': 'error',
    },
  },
  {
    files: ['**/*.mjs'],
    rules: {
      'no-undef': 'off',
    },
  }
);
