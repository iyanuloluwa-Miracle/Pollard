import * as vscode from 'vscode';
import { clearCache } from '../state';

export async function runClearCache(context: vscode.ExtensionContext): Promise<void> {
  await clearCache(context);
  vscode.window.showInformationMessage('Pollard: Cache cleared.');
}
