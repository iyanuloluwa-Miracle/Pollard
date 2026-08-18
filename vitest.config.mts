import * as path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Lets provider files that import 'vscode' at the value level (directly
    // or transitively, e.g. rate-limit.ts -> errors.ts) load under vitest —
    // see test/vscode-stub.ts for what's actually stubbed and why.
    alias: {
      vscode: path.resolve(dirname, 'test/vscode-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
