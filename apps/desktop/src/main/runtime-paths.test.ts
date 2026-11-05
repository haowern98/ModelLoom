import { afterEach, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { runtimePaths } from './runtime-paths';
import { removeTestRuntimeCopies, testRuntimeCopies } from '../../tests/packaged-runtime-cleanup';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const version = 'llama-cuda-development-test-00000000-0000-0000-0000-000000000000';
function testInstall() {
  const parent = path.resolve(__dirname, '../../out');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'runtime-cleanup-'));
  if (!root.startsWith(parent + path.sep)) throw Error('UNSAFE_TEST_ROOT');
  roots.push(root);
  mkdirSync(path.join(root, version));
  writeFileSync(path.join(root, version, 'runtime.txt'), 'test runtime');
  return root;
}

it('counts only installed versions and preserves the separate runtime cache during cleanup', () => {
  const root = testInstall();
  mkdirSync(path.join(root, 'runtime-cache'));
  writeFileSync(path.join(root, 'runtime-cache', 'keep.txt'), 'cache');
  expect(testRuntimeCopies(root)).toEqual([path.join(root, version)]);
  removeTestRuntimeCopies(root);
  expect(readFileSync(path.join(root, 'runtime-cache', 'keep.txt'), 'utf8')).toBe('cache');
  expect(testRuntimeCopies(root)).toEqual([]);
});

it('rejects unexpected installed entries before deleting any version', () => {
  const root = testInstall();
  mkdirSync(path.join(root, 'unexpected'));
  expect(() => removeTestRuntimeCopies(root)).toThrow('UNSAFE_TEST_RUNTIME_CLEANUP');
  expect(existsSync(path.join(root, version, 'runtime.txt'))).toBe(true);
  expect(readFileSync(path.join(root, version, 'runtime.txt'), 'utf8')).toBe('test runtime');
});

it('rejects a linked cache without touching its target or an installed version', () => {
  const root = testInstall();
  const target = testInstall();
  writeFileSync(path.join(target, 'keep.txt'), 'keep');
  symlinkSync(target, path.join(root, 'runtime-cache'), 'junction');
  expect(() => removeTestRuntimeCopies(root)).toThrow('UNSAFE_TEST_RUNTIME_CLEANUP');
  expect(readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
  expect(existsSync(path.join(root, version, 'runtime.txt'))).toBe(true);
  expect(readFileSync(path.join(root, version, 'runtime.txt'), 'utf8')).toBe('test runtime');
});

const input = {
  packaged: true,
  development: false,
  resources: 'E:\\Relocated Package\\resources',
  workspaceCore: 'E:\\checkout\\packages\\core',
  localData: 'C:\\Users\\tester\\AppData\\Local',
  home: 'C:\\Users\\tester',
};

it('keeps ordinary packaged runtime closed even with development resources present', () => {
  expect(runtimePaths(input)).toBeNull();
});

it('resolves all packaged development inputs from resources and isolates writable data', () => {
  expect(runtimePaths({ ...input, development: true })).toEqual({
    core: 'E:\\Relocated Package\\resources\\modelloom-development\\core',
    bootstrap: 'E:\\Relocated Package\\resources\\modelloom-development\\bootstrap',
    state: 'C:\\Users\\tester\\AppData\\Local\\ModelLoom-Development\\runtime',
    profile: 'C:\\Users\\tester\\.modelloom-packaged-development',
    chromium: 'C:\\Users\\tester\\AppData\\Local\\ModelLoom-Development\\chromium',
  });
});

it('puts installed runtimes under the existing Forge profile', () => {
  expect(runtimePaths({ ...input, packaged: false })).toEqual({
    core: 'E:\\checkout\\packages\\core',
    bootstrap: 'E:\\checkout\\packages\\core\\out\\activation\\b11306',
    state: 'E:\\checkout\\packages\\core\\out\\activation\\b11306',
    profile: 'C:\\Users\\tester\\.modelloom',
    runtimes: 'C:\\Users\\tester\\.modelloom\\runtimes',
  });
});

it('selects the staged b11307 bootstrap only for the source app', () => {
  expect(runtimePaths({ ...input, packaged: false, pairedBuild: true })).toMatchObject({
    bootstrap: 'E:\\checkout\\packages\\core\\out\\activation\\b11307',
    profile: 'C:\\Users\\tester\\.modelloom',
    runtimes: 'C:\\Users\\tester\\.modelloom\\runtimes',
  });
  expect(runtimePaths({ ...input, development: true, pairedBuild: true })).toEqual(
    runtimePaths({ ...input, development: true }),
  );
});
