import { defineConfig } from '@vscode/test-cli';
import { FIXTURE_DIR } from './out/test/fixtures/build-fixture-repo.js';

export default defineConfig([
  {
    label: 'integration',
    files: 'out/test/integration/**/*.test.js',
    workspaceFolder: FIXTURE_DIR,
    mocha: { timeout: 20000 },
  },
  {
    label: 'e2e',
    files: 'out/test/e2e/**/*.test.js',
    workspaceFolder: FIXTURE_DIR,
    mocha: { timeout: 20000 },
  },
]);
