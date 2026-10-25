import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TailscaleHelper } from './helper.js';

const roots: string[] = [];
const children: { helper: TailscaleHelper; exited: Promise<void> }[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    await child.helper.close();
    await child.exited;
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory() {
  const base = path.resolve('out');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'network-native-'));
  roots.push(root);
  return root;
}
function inert(root: string) {
  const executable = process.env.MODELLOOM_NETWORK_BINARY;
  if (!executable)
    throw Error('MODELLOOM_NETWORK_BINARY must identify the built native networking helper');
  const child = spawn(executable, [root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  const read = vi.fn(() => Promise.resolve(undefined)),
    write = vi.fn(() => Promise.resolve(undefined));
  const login = vi.fn(),
    status = vi.fn();
  const helper = new TailscaleHelper(
    child,
    { read, write },
    { login, status, incoming: (_port, stream) => stream.destroy(), lost: () => undefined },
  );
  children.push({ helper, exited });
  return { child, helper, exited, read, write, login, status };
}

it('real inert helper preserves opaque multi-frame enrollment across EOF restart without starting tsnet', async () => {
  const root = await directory(),
    first = inert(root);
  await first.helper.ready();
  expect(await first.helper.readCiphertext()).toBeUndefined();
  const bytes = randomBytes(100_003);
  await first.helper.replaceCiphertext(bytes);
  expect(await first.helper.readCiphertext()).toEqual(bytes);
  expect(await readFile(path.join(root, 'enrollment.bin'))).toEqual(bytes);
  expect((await readdir(root)).sort()).toEqual(['enrollment.bin', 'owner.lock']);
  // Parent pipe EOF must release the exact helper's lease without a connect command.
  first.child.stdin.end();
  await first.exited;
  const second = inert(root);
  await second.helper.ready();
  expect(await second.helper.readCiphertext()).toEqual(bytes);
  for (const instance of [first, second]) {
    expect(instance.login).not.toHaveBeenCalled();
    expect(instance.status).not.toHaveBeenCalled();
    expect(instance.read).not.toHaveBeenCalled();
    expect(instance.write).not.toHaveBeenCalled();
  }
});

it('real OS lease rejects a second helper and is released after terminating only its owner', async () => {
  const root = await directory(),
    first = inert(root);
  await first.helper.ready();
  const bytes = randomBytes(37);
  await first.helper.replaceCiphertext(bytes);
  const blocked = inert(root);
  await expect(blocked.helper.ready()).rejects.toThrow('NETWORK_COMPONENT_FAILED');
  await blocked.exited;
  expect(await readFile(path.join(root, 'enrollment.bin'))).toEqual(bytes);
  first.child.kill();
  await first.exited;
  const recovered = inert(root);
  await recovered.helper.ready();
  expect(await recovered.helper.readCiphertext()).toEqual(bytes);
  expect(recovered.login).not.toHaveBeenCalled();
  expect(recovered.read).not.toHaveBeenCalled();
});
