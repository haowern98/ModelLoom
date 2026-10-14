import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function removeOwnTemporaryTree(directory: string, prefix: string) {
  if (!path.isAbsolute(directory) || !directory.startsWith(prefix))
    throw new Error('Unsafe missing-binding test cleanup');
  await rm(directory, { recursive: true, force: true });
}

it.skipIf(process.platform !== 'win32')(
  'refuses missing ownership and storage bindings without creating an unguarded profile',
  async () => {
    const prefix = path.resolve(os.tmpdir(), 'modelloom-missing-native-');
    const directory = await mkdtemp(prefix);
    try {
      await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
      const hosts = path.join(directory, 'src/hosts');
      const history = path.join(directory, 'src/history');
      await mkdir(hosts, { recursive: true });
      await mkdir(history, { recursive: true });
      await copyFile(
        fileURLToPath(new URL('./windows-ownership.ts', import.meta.url)),
        path.join(hosts, 'windows-ownership.ts'),
      );
      await copyFile(
        fileURLToPath(new URL('../history/windows-directory.ts', import.meta.url)),
        path.join(history, 'windows-directory.ts'),
      );
      const script = `
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        (async () => {
          const ownership = await import(process.argv[1]);
          const storage = await import(process.argv[2]);
          assert.throws(() => ownership.ownershipBinding(), (error) =>
            error.code === 'MODULE_NOT_FOUND' && error.message.includes('ownership.node'));
          const profile = storage.trustedHistoryRoot(process.argv[3]);
          assert.throws(() => storage.openHistoryDirectory(profile), /^Error: HISTORY_UNAVAILABLE$/);
          assert.throws(() => storage.openConfigurationDirectory(profile), /^Error: CONFIGURATION_UNAVAILABLE$/);
          assert.equal(fs.existsSync(process.argv[3]), false);
          console.log('MISSING_BINDINGS_REFUSED_WITHOUT_PROFILE');
        })().catch(() => { process.exitCode = 1; });
      `;
      const output = execFileSync(
        process.execPath,
        [
          '--experimental-strip-types',
          '-e',
          script,
          pathToFileURL(path.join(hosts, 'windows-ownership.ts')).href,
          pathToFileURL(path.join(history, 'windows-directory.ts')).href,
          path.join(directory, 'profile'),
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      );
      expect(output.trim()).toBe('MISSING_BINDINGS_REFUSED_WITHOUT_PROFILE');
    } finally {
      await removeOwnTemporaryTree(directory, prefix);
    }
  },
);
