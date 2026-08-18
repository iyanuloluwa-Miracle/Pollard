import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, 'src');

/** Recursively lists every .ts file under dir (skipping .test.ts and .d.ts, which never register anything). */
function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function findIds(pattern) {
  const ids = new Set();
  for (const file of listTsFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

const registerCommandPattern = /registerCommand\(\s*['"]([^'"]+)['"]/g;
const registerTreeDataProviderPattern = /registerTreeDataProvider\(\s*['"]([^'"]+)['"]/g;

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const declaredCommands = new Set(
  (packageJson.contributes?.commands ?? []).map((c) => c.command)
);
const declaredViews = new Set(
  Object.values(packageJson.contributes?.views ?? {})
    .flat()
    .map((v) => v.id)
);

const registeredCommands = findIds(registerCommandPattern);
const registeredViews = findIds(registerTreeDataProviderPattern);

let ok = true;

function reportMismatch(label, declared, registered) {
  const missingRegistration = [...declared].filter((id) => !registered.has(id));
  const missingContribution = [...registered].filter((id) => !declared.has(id));
  if (missingRegistration.length > 0) {
    ok = false;
    console.error(
      `check-contributions: ${label} declared in package.json but never registered in src/: ${missingRegistration.join(', ')}`
    );
  }
  if (missingContribution.length > 0) {
    ok = false;
    console.error(
      `check-contributions: ${label} registered in src/ but not declared in package.json: ${missingContribution.join(', ')}`
    );
  }
}

reportMismatch('command(s)', declaredCommands, registeredCommands);
reportMismatch('view(s)', declaredViews, registeredViews);

if (ok) {
  console.log(
    `check-contributions: OK — ${declaredCommands.size} command(s) and ${declaredViews.size} view(s) match between package.json and src/.`
  );
  process.exit(0);
} else {
  process.exit(1);
}
