import { afterEach, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { ownershipBinding, confirmExit } from './windows-ownership.js';
const native = ownershipBinding();
const roots: object[] = [];
const children: object[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) native.closeDeployment(root);
  for (const child of children.splice(0)) {
    await confirmExit(() => {
      const o = native.observe(child);
      return o.exitCode !== -1 && o.activeProcesses === 0;
    });
    native.release(child);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    const parent = fileURLToPath(new URL('../../out/native/', import.meta.url));
    if (
      path.dirname(directory) !== path.resolve(parent) ||
      !path.basename(directory).startsWith('directory-anchor-')
    )
      throw new Error('INVALID_TEST_CLEANUP_PATH');
    rmSync(directory, { recursive: true, force: true });
  }
});
function start(mode = 'ready', gpu?: string) {
  const root = native.createDeployment();
  roots.push(root);
  const helper = fileURLToPath(
    new URL('../../out/native/ModelLoom-runtime-host.exe', import.meta.url),
  );
  const fixture = fileURLToPath(new URL('../../out/native/console-fixture.exe', import.meta.url));
  const child =
    gpu === undefined
      ? native.launchConsole(root, helper, [fixture, mode], os.tmpdir())
      : native.launchCudaConsole(root, helper, [fixture, mode], os.tmpdir(), gpu);
  children.push(child);
  let text = '';
  return {
    root,
    child,
    read() {
      const observation = native.observe(child);
      text += observation.output;
      return { ...observation, text };
    },
  };
}
it('keeps server cwd and DLL PATH anchored when the helper lives in a nested alias directory', async () => {
  const directory = fileURLToPath(new URL('../../out/native/', import.meta.url));
  const temporary = mkdtempSync(path.join(directory, 'directory-anchor-'));
  temporaryDirectories.push(temporary);
  const helperDirectory = path.join(temporary, '.modelloom-launch-helper');
  mkdirSync(helperDirectory);
  const helper = path.join(helperDirectory, 'ModelLoom Development.exe');
  copyFileSync(path.join(directory, 'ModelLoom-runtime-host.exe'), helper);
  const fixture = path.join(directory, 'console-fixture.exe');
  const root = native.createDeployment();
  roots.push(root);
  const child = native.launchConsole(root, helper, [fixture, 'directories'], temporary);
  children.push(child);
  let text = '';
  const read = () => {
    const observation = native.observe(child);
    text += observation.output.replaceAll('\r\n', '\n');
    return observation;
  };
  await expect
    .poll(
      () => {
        read();
        return text;
      },
      { timeout: 5000 },
    )
    .toContain('READY HIDDEN');
  expect(text).toContain(`CWD ${path.resolve(directory)}\n`);
  expect(text.toLowerCase()).toContain(
    `PATH ${path.resolve(directory)};${native.systemDirectory()}\n`.toLowerCase(),
  );
  expect(text).toContain(`CACHE ${temporary}\n`);
  expect(text).toContain('CACHE LIMIT 268435456\n');
  native.captureServer(child, Number(text.match(/^ENGINE ([0-9]+)$/mu)?.[1]), fixture);
  native.requestStop(child);
  await expect
    .poll(() => {
      const observation = read();
      return observation.activeProcesses === 0 && observation.exitCode !== -1;
    })
    .toBe(true);
  expect(read().exitCode).toBe(0);
  expect(text).toContain('CLEANUP');
});
it('delivers Ctrl+C once in a hidden private console and observes cleanup plus exit', async () => {
  const instance = start();
  await expect.poll(() => instance.read().text).toContain('READY HIDDEN');
  const pid = Number(instance.read().text.match(/^ENGINE ([0-9]+)$/mu)?.[1]);
  native.captureServer(
    instance.child,
    pid,
    fileURLToPath(new URL('../../out/native/console-fixture.exe', import.meta.url)),
  );
  expect(native.ownedListener(instance.child, 9999)).toBe(false);
  expect(instance.read().peakWorkingSet).toBeGreaterThan(0);
  expect(instance.read().peakJobCommit).toBeGreaterThan(0);
  native.requestStop(instance.child);
  native.requestStop(instance.child);
  await expect.poll(() => instance.read().activeProcesses).toBe(0);
  expect(instance.read()).toMatchObject({ exitCode: 0 });
  expect(instance.read().text).toContain('CLEANUP');
});
it('contains an actual synthetic native exception while an independent deployment stays usable', async () => {
  const fault = start('fault'),
    independent = start();
  await expect.poll(() => fault.read().text).toContain('READY HIDDEN');
  await expect.poll(() => independent.read().text).toContain('READY HIDDEN');
  const pid = Number(fault.read().text.match(/^ENGINE ([0-9]+)$/mu)?.[1]);
  native.captureServer(
    fault.child,
    pid,
    fileURLToPath(new URL('../../out/native/console-fixture.exe', import.meta.url)),
  );
  native.requestStop(fault.child);
  await expect
    .poll(() => {
      const observation = fault.read();
      return observation.activeProcesses === 0 && observation.exitCode !== -1;
    })
    .toBe(true);
  // Application-defined, noncontinuable SEH exception from the harmless fixture.
  expect(fault.read().exitCode >>> 0).toBe(0xe0421001);
  expect(fault.read().text).not.toContain('CLEANUP');
  expect(independent.read().exitCode).toBe(-1);
  native.requestStop(independent.child);
  await expect
    .poll(() => {
      const observation = independent.read();
      return observation.activeProcesses === 0 && observation.exitCode !== -1;
    })
    .toBe(true);
  expect(independent.read().exitCode).toBe(0);
  expect(independent.read().text).toContain('CLEANUP');
});
it('passes only the selected full GPU UUID to its child and leaves an independent CPU child isolated', async () => {
  const uuid = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
  const previous = process.env.CUDA_VISIBLE_DEVICES;
  process.env.CUDA_VISIBLE_DEVICES = 'ambient-override';
  try {
    const selected = start('gpu', uuid),
      cpu = start('gpu');
    await expect.poll(() => selected.read().text).toContain(`GPU ${uuid}`);
    await expect.poll(() => cpu.read().text).toContain('GPU NONE');
    expect(cpu.read().text).not.toContain(uuid);
    native.requestStop(selected.child);
    await expect.poll(() => selected.read().activeProcesses).toBe(0);
    expect(cpu.read().exitCode).toBe(-1);
  } finally {
    if (previous === undefined) delete process.env.CUDA_VISIBLE_DEVICES;
    else process.env.CUDA_VISIBLE_DEVICES = previous;
  }
});
it.each([
  '0',
  'GPU-22c23971',
  'GPU-22c23971-dacf-2123-2169-ad70d8f6729a,1',
  'MIG-GPU-22c23971-dacf-2123-2169-ad70d8f6729a/1/2',
])('rejects ambiguous native GPU selection before creating a child', (uuid) => {
  const root = native.createDeployment();
  roots.push(root);
  expect(() => native.launchCudaConsole(root, 'unused.exe', [], os.tmpdir(), uuid)).toThrow(
    'INVALID_CONTROL',
  );
  expect(native.coresExited(root)).toBe(true);
});
it('force-cleans a hung signal handler without stopping an independent console', async () => {
  const first = start('hang'),
    second = start();
  await expect.poll(() => first.read().text).toContain('READY HIDDEN');
  await expect.poll(() => second.read().text).toContain('READY HIDDEN');
  native.requestStop(first.child);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(first.read().exitCode).toBe(-1);
  native.forceStop(first.child);
  await expect.poll(() => first.read().activeProcesses).toBe(0);
  expect(second.read().exitCode).toBe(-1);
  native.requestStop(second.child);
  await expect.poll(() => second.read().activeProcesses).toBe(0);
  expect(second.read().text).toContain('CLEANUP');
});
it('contains helper loss and refuses stale released control', async () => {
  const instance = start();
  await expect.poll(() => instance.read().text).toContain('READY HIDDEN');
  native.closeDeployment(instance.root);
  await expect
    .poll(() => {
      const state = instance.read();
      return state.activeProcesses === 0 && state.exitCode !== -1;
    })
    .toBe(true);
  native.release(instance.child);
  children.splice(children.indexOf(instance.child), 1);
  expect(() => native.requestStop(instance.child)).toThrow('INVALID_CONTROL');
});
it('cancels before an engine installs its Ctrl+C handler using owned termination', async () => {
  const instance = start('loading');
  await expect.poll(() => instance.read().text).toContain('LOADING HIDDEN');
  native.forceStop(instance.child);
  await expect.poll(() => instance.read().activeProcesses).toBe(0);
  expect(instance.read().text).not.toContain('CLEANUP');
});
it('rejects a process outside the captured job before it can establish readiness', async () => {
  const instance = start();
  await expect.poll(() => instance.read().text).toContain('READY HIDDEN');
  expect(() => native.captureServer(instance.child, process.pid, process.execPath)).toThrow(
    'OWNERSHIP_FAILED',
  );
});
it('checks the actual retained server owns its exact loopback listener', async () => {
  const instance = start('listen');
  await expect.poll(() => instance.read().text).toContain('READY HIDDEN');
  const text = instance.read().text,
    pid = Number(text.match(/^ENGINE ([0-9]+)$/mu)?.[1]),
    port = Number(text.match(/^PORT ([0-9]+)$/mu)?.[1]);
  native.captureServer(
    instance.child,
    pid,
    fileURLToPath(new URL('../../out/native/console-fixture.exe', import.meta.url)),
  );
  expect(native.ownedListener(instance.child, port)).toBe(true);
  expect(native.ownedListener(instance.child, port === 65535 ? 65534 : port + 1)).toBe(false);
  native.requestStop(instance.child);
  await expect
    .poll(() => {
      const o = instance.read();
      return o.activeProcesses === 0 && o.exitCode !== -1;
    })
    .toBe(true);
  expect(native.ownedListener(instance.child, port)).toBe(false);
});
it('does not inherit a caller environment override', async () => {
  const previous = process.env.LLAMA_ARG_CTX_SIZE;
  process.env.LLAMA_ARG_CTX_SIZE = '1';
  try {
    const instance = start();
    await expect.poll(() => instance.read().text).toContain('READY HIDDEN');
  } finally {
    if (previous === undefined) delete process.env.LLAMA_ARG_CTX_SIZE;
    else process.env.LLAMA_ARG_CTX_SIZE = previous;
  }
});
