import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**', '**/*.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-duplicate-imports': 'error',
    },
  },
);
