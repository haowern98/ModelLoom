import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { ownershipBinding, confirmExit } from './windows-ownership.js';

const native = ownershipBinding();
const fixture = fileURLToPath(new URL('../../out/native/console-fixture.exe', import.meta.url));
const helper = fileURLToPath(
  new URL('../../out/native/ModelLoom-runtime-host.exe', import.meta.url),
);
const roots: object[] = [],
  children: object[] = [],
  credentials: object[] = [];
const owners: ReturnType<typeof spawn>[] = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) if (owner.exitCode === null) owner.kill();
  for (const credential of credentials.splice(0)) native.releaseCredential(credential);
  for (const root of roots.splice(0)) native.closeDeployment(root);
  for (const child of children.splice(0)) {
    await confirmExit(() => {
      const o = native.observe(child);
      return o.exitCode !== -1 && o.activeProcesses === 0;
    });
    native.release(child);
  }
});
function root() {
  const value = native.createDeployment();
  roots.push(value);
  return value;
}
function credential(deployment: object, nonce = randomUUID()) {
  const value = native.createCredential(deployment, nonce, 'A'.repeat(43));
  credentials.push(value);
  return value;
}
async function reader(deployment: object, pipe: string) {
  const child = native.launchConsole(
    deployment,
    helper,
    [fixture, 'credential', pipe],
    fileURLToPath(new URL('../../out/native', import.meta.url)),
  );
  children.push(child);
  let output = '';
  await expect
    .poll(() => {
      output += native.observe(child).output;
      return output;
    })
    .toMatch(/^ENGINE [0-9]+/mu);
  native.captureServer(child, Number(output.match(/^ENGINE ([0-9]+)/mu)?.[1]), fixture);
  return child;
}
it('delivers one private text stream only to the retained owned server, without a disk key', async () => {
  const directory = fileURLToPath(new URL('../../out/native', import.meta.url));
  const before = readdirSync(directory);
  const deployment = root(),
    key = credential(deployment),
    pipe = native.credentialPath(key);
  expect(pipe).toMatch(/^\\\\\.\\pipe\\ModelLoom-key-[0-9a-f-]{36}$/u);
  // Stat/exists on a Windows pipe can connect as its first client. Observe the
  // disk directory instead, without consuming the single-use capability.
  expect(readdirSync(directory)).toEqual(before);
  const child = await reader(deployment, pipe);
  await expect.poll(() => native.deliverCredential(key, child)).toBe(true);
  let text = '';
  await expect
    .poll(() => {
      text += native.observe(child).output;
      return text;
    })
    .toContain('CREDENTIAL RECEIVED');
  native.releaseCredential(key);
  expect(() => native.credentialPath(key)).toThrow('INVALID_CONTROL');
  native.requestStop(child);
  await expect.poll(() => native.observe(child).activeProcesses).toBe(0);
});
it('rejects a connection from another local process before writing credential bytes', async () => {
  const deployment = root(),
    key = credential(deployment),
    pipe = native.credentialPath(key);
  const stranger = net.connect(pipe);
  let bytes = 0;
  stranger.on('data', (data) => {
    bytes += data.length;
  });
  stranger.on('error', () => {});
  await new Promise<void>((resolve, reject) =>
    stranger.once('connect', resolve).once('error', reject),
  );
  const child = native.launchConsole(
    deployment,
    helper,
    [fixture, 'ready'],
    fileURLToPath(new URL('../../out/native', import.meta.url)),
  );
  children.push(child);
  let output = '';
  await expect
    .poll(() => {
      output += native.observe(child).output;
      return output;
    })
    .toContain('READY HIDDEN');
  native.captureServer(child, Number(output.match(/^ENGINE ([0-9]+)/mu)?.[1]), fixture);
  expect(() => native.deliverCredential(key, child)).toThrow('OWNERSHIP_FAILED');
  native.releaseCredential(key);
  stranger.destroy();
  expect(bytes).toBe(0);
});
it('rejects another deployment even when its server opens the exact pipe', async () => {
  const first = root(),
    second = root(),
    key = credential(first);
  const child = await reader(second, native.credentialPath(key));
  expect(() => native.deliverCredential(key, child)).toThrow('OWNERSHIP_FAILED');
});
it('rejects malformed secrets, pipe-name injection and first-instance collisions', () => {
  const deployment = root(),
    nonce = randomUUID();
  credential(deployment, nonce);
  expect(() => native.createCredential(deployment, nonce, 'A'.repeat(43))).toThrow(
    'OWNERSHIP_FAILED',
  );
  expect(() => native.createCredential(deployment, '../other', 'A'.repeat(43))).toThrow(
    'INVALID_CONTROL',
  );
  expect(() => native.createCredential(deployment, randomUUID(), 'bad\nkey')).toThrow(
    'INVALID_CONTROL',
  );
  expect(() => native.deliverCredential({}, {})).toThrow('INVALID_CONTROL');
});
it('cancels an unopened pipe, permits repeated release and leaves independent delivery usable', async () => {
  const deployment = root(),
    key = credential(deployment),
    pipe = native.credentialPath(key);
  // No client has connected: native close must drain the pending ConnectNamedPipe.
  native.releaseCredential(key);
  expect(() => native.releaseCredential(key)).not.toThrow();
  expect(() => native.credentialPath(key)).toThrow('INVALID_CONTROL');
  const unavailable = await new Promise<boolean>((resolve) => {
    const client = net.connect(pipe);
    client.once('connect', () => {
      client.destroy();
      resolve(false);
    });
    client.once('error', () => resolve(true));
  });
  expect(unavailable).toBe(true);
  const independent = root(),
    next = credential(independent),
    child = await reader(independent, native.credentialPath(next));
  expect(() => native.deliverCredential(key, child)).toThrow('INVALID_CONTROL');
  await expect.poll(() => native.deliverCredential(next, child)).toBe(true);
});
it.each(['loading', 'ready'])(
  'owner termination removes the private pipe and owned native tree during %s',
  async (phase) => {
    const entry = fileURLToPath(new URL('../../tests/credential-owner.cjs', import.meta.url));
    const owner = spawn(process.execPath, [entry, phase], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    owners.push(owner);
    const receipt = await new Promise<{ pipe: string; pids: number[] }>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('No credential owner receipt')), 5000);
      owner.stdout?.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        if (text.includes('\n')) {
          clearTimeout(timer);
          const value: unknown = JSON.parse(text.trim());
          if (
            !value ||
            typeof value !== 'object' ||
            !('pipe' in value) ||
            typeof value.pipe !== 'string' ||
            !('pids' in value) ||
            !Array.isArray(value.pids) ||
            value.pids.length !== 2 ||
            !value.pids.every(
              (pid: unknown) => typeof pid === 'number' && Number.isInteger(pid) && pid > 0,
            )
          ) {
            reject(new Error('Invalid credential owner receipt'));
            return;
          }
          resolve({ pipe: value.pipe, pids: value.pids as number[] });
        }
      });
      owner.once('error', reject);
    });
    const exit = new Promise<void>((resolve) => owner.once('exit', () => resolve()));
    expect(owner.kill()).toBe(true);
    await exit;
    const running = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await expect.poll(() => receipt.pids.filter(running)).toEqual([]);
    const unavailable = await new Promise<boolean>((resolve) => {
      const client = net.connect(receipt.pipe);
      client.once('connect', () => {
        client.destroy();
        resolve(false);
      });
      client.once('error', () => resolve(true));
    });
    expect(unavailable).toBe(true);
    // A separately owned deployment still completes its own credential exchange.
    const independent = root(),
      key = credential(independent),
      child = await reader(independent, native.credentialPath(key));
    await expect.poll(() => native.deliverCredential(key, child)).toBe(true);
  },
);
