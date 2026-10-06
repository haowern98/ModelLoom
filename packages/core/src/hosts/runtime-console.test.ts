import { afterEach, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { ownershipBinding, confirmExit } from './windows-ownership.js';
const native = ownershipBinding();
const roots: object[] = [];
const children: object[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) native.closeDeployment(root);
  for (const child of children.splice(0)) {
    await confirmExit(() => {
      const o = native.observe(child);
      return o.exitCode !== -1 && o.activeProcesses === 0;
    });
    native.release(child);
  }
});
function start(mode = 'ready') {
  const root = native.createDeployment();
  roots.push(root);
  const helper = fileURLToPath(
    new URL('../../out/native/ModelLoom-runtime-host.exe', import.meta.url),
  );
  const fixture = fileURLToPath(new URL('../../out/native/console-fixture.exe', import.meta.url));
  const child = native.launchConsole(root, helper, [fixture, mode], os.tmpdir());
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
  native.requestStop(instance.child);
  native.requestStop(instance.child);
  await expect.poll(() => instance.read().activeProcesses).toBe(0);
  expect(instance.read()).toMatchObject({ exitCode: 0 });
  expect(instance.read().text).toContain('CLEANUP');
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
