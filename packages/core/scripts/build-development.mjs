import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import {
  DEVELOPMENT_ROOT,
  DEVELOPMENT_MEMORY_REPORTS,
} from '../out/runtime-package/development-policy.js';
// Run build:hosts first. This standalone tool changes ignored output only; ordinary builds reset it.
if (process.argv.length !== 2) throw new Error('Use build-development.mjs without arguments');
const root = await readFile(new URL('../assets/development-root.json', import.meta.url));
if (createHash('sha256').update(root).digest('hex') !== DEVELOPMENT_ROOT.sha256)
  throw new Error('INVALID_TRUST_ROOT');
await writeFile(
  new URL('../out/runtime-package/development-policy.js', import.meta.url),
  `export const DEVELOPMENT_BUILD = true;\nexport const DEVELOPMENT_ROOT = Object.freeze(${JSON.stringify(DEVELOPMENT_ROOT)});\nexport const DEVELOPMENT_MEMORY_REPORTS = Object.freeze(${JSON.stringify(DEVELOPMENT_MEMORY_REPORTS)});\n`,
);
console.log('Development-only build enabled; production trust and memory catalogues remain empty.');
