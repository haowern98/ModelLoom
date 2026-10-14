import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export function testRuntimeCopies(installedRoot: string): string[] {
  if (!existsSync(installedRoot)) return [];
  const root = path.resolve(installedRoot);
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error('UNSAFE_TEST_RUNTIME_CLEANUP');
  const copies: string[] = [];
  for (const name of readdirSync(root)) {
    const target = path.resolve(root, name);
    const entry = lstatSync(target);
    if (!target.startsWith(root + path.sep) || !entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('UNSAFE_TEST_RUNTIME_CLEANUP');
    if (name === 'runtime-cache') continue;
    if (!/^llama-cuda-development-.*-[a-f0-9-]{36}$/u.test(name))
      throw new Error('UNSAFE_TEST_RUNTIME_CLEANUP');
    copies.push(target);
  }
  return copies;
}

/** Validate all test-owned installed entries before deleting a version; retain its cache. */
export function removeTestRuntimeCopies(installedRoot: string): void {
  for (const target of testRuntimeCopies(installedRoot)) rmSync(target, { recursive: true });
}
