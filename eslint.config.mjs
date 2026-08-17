// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  { ignores: ['dist', 'out', 'node_modules', 'esbuild.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      curly: 'warn',
      eqeqeq: 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  eslintConfigPrettier
);
