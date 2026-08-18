// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  { ignores: ['dist', 'out', 'node_modules', 'scripts/esbuild.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    rules: {
      curly: 'warn',
      eqeqeq: 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/safety/**/*.ts', 'src/git/exec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'vscode', message: 'safety/ and git/exec.ts must stay pure — no vscode import.' }] },
      ],
    },
  },
  {
    files: ['src/git/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/views/*', '**/views', '**/providers/*', '**/providers'],
              message: 'git/ may not import from views/ or providers/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['**/views/*', '**/views'], message: 'providers/ may not import from views/.' }],
        },
      ],
    },
  },
  eslintConfigPrettier
);
