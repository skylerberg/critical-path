import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import noUnqualifiedKyselyColumns from './eslint-rules/no-unqualified-kysely-columns.js';

export default tseslint.config(eslint.configs.recommended, tseslint.configs.recommended, {
  plugins: {
    local: {
      rules: {
        'no-unqualified-kysely-columns': noUnqualifiedKyselyColumns,
      },
    },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
    'local/no-unqualified-kysely-columns': 'error',
  },
});
