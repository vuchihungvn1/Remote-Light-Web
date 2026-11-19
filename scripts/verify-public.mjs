import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const shellFiles = ['index.html', 'sw.js'];
const repositoryFiles = new Set([
  'README.md',
  '.github/workflows/pages.yml',
  '.github/workflows/verify-installer.yml',
  '.github/workflows/test-controller.yml',
  'scripts/verify-public.mjs',
  'scripts/test-controller.cjs',
]);
const assetName = /^assets\/(?:index|rtc|manifest)-[\w-]+\.(?:js|css|webmanifest)$/;
const exposedCredential = /postgres(?:ql)?:\/\/[^\s"'<>]+:[^\s"'<>]+@|-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|github_pat_[a-zA-Z0-9_]{20,}|\bgh[pousr]_[a-zA-Z0-9]{30,}|sourceMappingURL\s*=/;
const files = new Set();
const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' });

for (const entry of entries.split('\0').filter(Boolean)) {
  const match = /^100644 [a-f0-9]+ 0\t([\s\S]+)$/.exec(entry);
  if (!match) throw new Error('Public checkout contains a nonregular or unresolved file');
  const [, file] = match;
  if (repositoryFiles.has(file)) continue;
  if (!shellFiles.includes(file) && !assetName.test(file)) {
    throw new Error(`Unexpected tracked path: ${file}`);
  }
  if (exposedCredential.test(readFileSync(file, 'utf8'))) {
    throw new Error(`Obvious credential or source map marker in ${file}`);
  }
  files.add(file);
}
for (const file of shellFiles) {
  if (!files.has(file)) throw new Error(`Missing ${file}`);
}

const html = readFileSync('index.html', 'utf8');
const references = new Set();
for (const [, file] of html.matchAll(/(?:href|src)="\.\/(assets\/[^"]+)"/g)) {
  if (!assetName.test(file) || !files.has(file)) throw new Error(`Missing or invalid asset: ${file}`);
  references.add(file);
}
for (const file of files) {
  if (assetName.test(file) && !references.has(file)) throw new Error(`Old or unused bundle: ${file}`);
}
for (const extension of ['.js', '.css', '.webmanifest']) {
  if (![...references].some(file => file.endsWith(extension))) throw new Error(`Missing ${extension} asset`);
}
const integrityReferences = [...html.matchAll(/(?:href|src)="\.\/(assets\/[^"]+)"\s+integrity="sha384-([^"]+)"/g)];
if (integrityReferences.length === 0) throw new Error('Missing SRI');
for (const [, asset, expected] of integrityReferences) {
  if (!references.has(asset)) throw new Error(`Unknown SRI target: ${asset}`);
  const actual = createHash('sha384').update(readFileSync(asset)).digest('base64');
  if (actual !== expected) throw new Error(`SRI mismatch: ${asset}`);
}

if (process.argv[2]) {
  const stage = resolve(process.argv[2]);
  mkdirSync(stage);
  for (const file of files) {
    const destination = join(stage, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }
}
console.log(`Verified ${files.size} public web files.`);
