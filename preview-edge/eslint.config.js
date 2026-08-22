import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// This package was the one with no linter, on the grounds that 194 lines of
// Node HTTP handling had nothing for a linter to say — which was measured and
// true, and stops being an argument the moment a fifth file is added. Same
// rules as the other three, so `lint` means one thing in all four.
export default tseslint.config(
  { ignores: ['dist/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  }
);
