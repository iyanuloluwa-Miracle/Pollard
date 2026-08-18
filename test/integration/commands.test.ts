import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'pollard-dev.pollard';

const EXPECTED_COMMAND_IDS = [
  'pollard.scan',
  'pollard.clean',
  'pollard.restore',
  'pollard.pruneBackups',
  'pollard.refresh',
  'pollard.connectGithub',
  'pollard.connectGitlab',
  'pollard.clearCache',
  'pollard.deleteBranch',
];

describe('integration: command registration', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `expected extension ${EXTENSION_ID} to be installed in the test host`);
    if (!ext.isActive) await ext.activate();
  });

  it('registers every command declared in package.json contributes.commands', async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const id of EXPECTED_COMMAND_IDS) {
      assert.ok(registered.includes(id), `expected "${id}" to be a registered command`);
    }
  });
});
