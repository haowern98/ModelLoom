import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import {
  createRuntimeLog,
  forwardUtilityDiagnostics,
  nativeRuntimeDiagnostics,
} from './runtime-diagnostics.js';

it('writes readable terminal diagnostics and a bounded log without terminal controls', async () => {
  const root = await mkdtemp(path.resolve('out/runtime-logging-'));
  const output: string[] = [];
  try {
    const logger = createRuntimeLog(root, (text) => {
      output.push(text);
    });
    for (let i = 0; i < 300; ++i) logger.write('runtime', `load.begin ${i} ${'x'.repeat(4096)}`);
    logger.write('runtime', 'native.exit code=1 reason=OWNERSHIP_FAILED\u001b[31m\r\n');
    await logger.flush();
    const saved = await readFile(path.join(root, 'runtime.log'), 'utf8');
    expect(Buffer.byteLength(saved)).toBeLessThanOrEqual(524288);
    expect(saved).toContain('[ModelLoom][runtime] native.exit code=1 reason=OWNERSHIP_FAILED');
    expect(saved).not.toContain('\u001b');
    expect(output.at(-1)).toContain('native.exit code=1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('retains fragmented native errors and excludes prompts, generated text and credentials', () => {
  const lines: string[] = [];
  const native = nativeRuntimeDiagnostics(
    (_source, text) => {
      lines.push(text);
    },
    ['private-api-key'],
  );
  native.push('ENGINE 123\nuser prompt: secret question\nload_ten');
  native.push('sors: allocating CUDA0 8000 MiB\nCUDA error: allocation failed private-api-key');
  native.flush();
  native.push('load_tensors: after readiness\ngenerated answer\nCUDA error: device lost\n', true);
  expect(lines).toEqual([
    'load_tensors: allocating CUDA0 8000 MiB',
    'CUDA error: allocation failed [redacted]',
    'CUDA error: device lost',
  ]);
});

it('forwards only identified core diagnostics through fragmented utility pipes', () => {
  const stdout = new PassThrough(),
    stderr = new PassThrough();
  const lines: string[] = [];
  forwardUtilityDiagnostics({ stdout, stderr }, (_source, text) => {
    lines.push(text);
  });
  stderr.write('[Model');
  stderr.write('Loom][peer] heartbeat retry ETIMEDOUT\nprivate prompt\n');
  stdout.end('[ModelLoom][worker] stream.closed');
  expect(lines).toContain('heartbeat retry ETIMEDOUT');
  expect(lines.some((line) => line.includes('private prompt'))).toBe(false);
  stdout.destroy();
  stderr.destroy();
});

it('keeps terminal output available when diagnostic file writes fail', async () => {
  const output: string[] = [];
  const logger = createRuntimeLog(path.resolve('out/absent-runtime-log/absent'), (text) => {
    output.push(text);
  });
  logger.write('app', 'logging.started');
  await expect(logger.flush()).resolves.toBeUndefined();
  expect(output).toHaveLength(1);
});

it('appends to the same file so an already-open PowerShell tail sees new events', async () => {
  const root = await mkdtemp(path.resolve('out/runtime-follow-'));
  try {
    const logger = createRuntimeLog(root, () => undefined);
    logger.write('runtime', 'load.begin');
    await logger.flush();
    const follower = await open(path.join(root, 'runtime.log'), 'r');
    try {
      logger.write('runtime', 'native.exit code=1');
      await logger.flush();
      expect(await follower.readFile('utf8')).toContain('native.exit code=1');
    } finally {
      await follower.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps shared viewer history bounded and clears it without replaying old events', async () => {
  const logger = createRuntimeLog(
    path.resolve('out/absent-runtime-viewer/absent'),
    () => undefined,
  );
  for (let i = 0; i < 3000; ++i) logger.write('runtime', `load.begin ${i}`);
  let snapshot = logger.read();
  expect(snapshot.entries!.length).toBeLessThanOrEqual(2048);
  expect(snapshot.entries!.at(-1)?.message).toBe('load.begin 2999');
  expect(logger.read(snapshot.revision).entries).toBeNull();
  for (let i = 0; i < 200; ++i) logger.write('runtime', `CUDA error: ${'x'.repeat(4000)}`);
  snapshot = logger.read();
  expect(Buffer.byteLength(JSON.stringify(snapshot.entries))).toBeLessThanOrEqual(524288);
  expect(snapshot.entries!.at(-1)?.level).toBe('error');
  logger.clear();
  expect(logger.read().entries).toEqual([]);
  logger.write('chat', 'request.completed');
  expect(logger.read().entries).toHaveLength(1);
  logger.write('worker', 'helper.exit code=1');
  expect(logger.read().entries!.at(-1)?.level).toBe('error');
  await logger.flush();
});
