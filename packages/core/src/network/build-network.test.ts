import path from 'node:path';
import type * as ChildProcess from 'node:child_process';
import type * as FileSystem from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const separator = process.platform === 'win32' ? '\\' : '/';
  const root = process.platform === 'win32' ? 'C:\\modelloom-cold-cache' : '/modelloom-cold-cache';
  const moduleDir = `${root}${separator}gvisor.dev${separator}gvisor@v0.0.0-20260915211658-a6f909f08a72`;
  return {
    execFileSync: vi.fn<(command: string, args: readonly string[], options: unknown) => string>(),
    sourceRead: vi.fn<(file: string) => void>(),
    moduleDir,
    sourceFile: `${moduleDir}${separator}pkg${separator}tcpip${separator}transport${separator}tcp${separator}snd.go`,
    scratchDir: `${root}${separator}scratch`,
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return { ...actual, execFileSync: mocks.execFileSync };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(() => mocks.scratchDir),
    rmSync: vi.fn(),
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      const [file] = args;
      if (String(file) === mocks.sourceFile) {
        mocks.sourceRead(String(file));
        throw new Error('DOWNLOADED_MODULE_SOURCE_REACHED');
      }
      return actual.readFileSync(...args);
    }),
  };
});

const buildScriptUrl = new URL('../../scripts/build-network.mjs', import.meta.url).href;
const pinnedVersion = 'v0.0.0-20260915211658-a6f909f08a72';
let downloadMetadata: Record<string, unknown>;
let downloadFailure: Error | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  downloadFailure = undefined;
  downloadMetadata = {
    Path: 'gvisor.dev/gvisor',
    Version: pinnedVersion,
    Info: 'cold-cache-fixture.info',
    GoMod: 'cold-cache-fixture.mod',
    Zip: 'cold-cache-fixture.zip',
    Dir: mocks.moduleDir,
    Sum: 'h1:fixture-module-checksum',
    GoModSum: 'h1:fixture-go-mod-checksum',
  };
  mocks.execFileSync.mockImplementation((_command, args) => {
    if (args[0] === 'env' && args[1] === 'GOVERSION') return 'go1.27.3\n';
    if (args[0] === 'mod' && args[1] === 'download') {
      if (downloadFailure) throw downloadFailure;
      return `${JSON.stringify(downloadMetadata)}\n`;
    }
    if (args[0] === 'mod' && args[1] === 'verify') return 'all modules verified\n';
    if (args[0] === 'list' && args.includes('gvisor.dev/gvisor'))
      return `${JSON.stringify({ Version: pinnedVersion })}\n`;
    throw new Error(`Unexpected Go command: ${args.join(' ')}`);
  });
});

async function executeBuildScript() {
  vi.resetModules();
  const originalArgv = process.argv;
  process.argv = [process.execPath, buildScriptUrl, '--target', 'windows-amd64'];
  try {
    await import(/* @vite-ignore */ buildScriptUrl);
  } finally {
    process.argv = originalArgv;
  }
}

it('downloads the pinned gVisor source before resolving it from a cold module cache', async () => {
  await expect(executeBuildScript()).rejects.toThrow('DOWNLOADED_MODULE_SOURCE_REACHED');

  expect(mocks.execFileSync).toHaveBeenCalledWith(
    'go',
    ['mod', 'download', '-json', 'gvisor.dev/gvisor'],
    expect.objectContaining({ encoding: 'utf8' }),
  );
  expect(mocks.sourceRead).toHaveBeenCalledWith(
    path.join(mocks.moduleDir, 'pkg/tcpip/transport/tcp/snd.go'),
  );
});

it('stops after a failed gVisor download without reading module source', async () => {
  downloadFailure = new Error('gVisor download failed');

  await expect(executeBuildScript()).rejects.toThrow('gVisor download failed');

  expect(mocks.sourceRead).not.toHaveBeenCalled();
  expect(mocks.execFileSync.mock.calls.some(([, args]) => args[0] === 'build')).toBe(false);
});

it('keeps the pinned gVisor version guard', async () => {
  downloadMetadata.Version = 'v0.0.0-unreviewed';

  await expect(executeBuildScript()).rejects.toThrow(
    'Revalidate the TCP patch before changing gVisor',
  );

  expect(mocks.sourceRead).not.toHaveBeenCalled();
});

it('rejects downloaded metadata without a usable source directory', async () => {
  delete downloadMetadata.Dir;

  await expect(executeBuildScript()).rejects.toThrow('Cannot locate downloaded gVisor source');

  expect(mocks.sourceRead).not.toHaveBeenCalled();
});
