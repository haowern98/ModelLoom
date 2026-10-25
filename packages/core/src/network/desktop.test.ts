import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  spawn: vi.fn(),
  ready: vi.fn<() => Promise<void>>(),
  command: vi.fn(),
  close: vi.fn<(child: EventEmitter) => Promise<void>>(),
  ciphertext: undefined as Buffer | undefined,
  replace: vi.fn<(bytes: Buffer) => Promise<void>>(),
}));
vi.mock('node:child_process', () => ({ spawn: fixtures.spawn }));
vi.mock('./helper.js', () => ({
  TailscaleHelper: class {
    constructor(private child: EventEmitter) {}
    ready() {
      return fixtures.ready();
    }
    readCiphertext() {
      return Promise.resolve(fixtures.ciphertext);
    }
    async replaceCiphertext(bytes: Buffer) {
      await fixtures.replace(bytes);
      fixtures.ciphertext = bytes;
    }
    command = fixtures.command;
    dial = vi.fn();
    close() {
      return fixtures.close(this.child);
    }
  },
}));
import { createDesktopNetwork } from './desktop.js';
import { openNetworkStore } from './store.js';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.resetAllMocks();
  fixtures.ciphertext = undefined;
});
async function setup() {
  await mkdir(path.resolve('out'), { recursive: true });
  const root = await mkdtemp(path.resolve('out/network-desktop-test-'));
  roots.push(root);
  const executable = path.join(root, 'component');
  await writeFile(executable, 'inert test executable');
  const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      protocol: 1,
      target,
      goVersion: '1.27.3',
      tailscaleVersion: '1.104.2',
      sha256: createHash('sha256')
        .update(await readFile(executable))
        .digest('hex'),
    }),
  );
  const protection = {
    available: () => true,
    encrypt: vi.fn((text: string) => Buffer.from(text)),
    decrypt: vi.fn((bytes: Buffer) => bytes.toString()),
  };
  const openLogin = vi.fn(() => Promise.resolve(undefined));
  fixtures.ready.mockResolvedValue(undefined);
  fixtures.command.mockResolvedValue(undefined);
  fixtures.close.mockImplementation((child) => {
    child.emit('exit', 0);
    return Promise.resolve();
  });
  fixtures.replace.mockResolvedValue(undefined);
  fixtures.spawn.mockImplementation(() => new EventEmitter());
  const directory = path.join(root, 'enrollment');
  const create = () => createDesktopNetwork({ executable, directory, protection, openLogin });
  const seed = async () => {
    const store = await openNetworkStore(directory, protection);
    await store.write('modelloom:enabled', Buffer.from('0'));
    await store.write('test-enrollment', Buffer.from('unchanged enrollment'));
    await store.close();
    fixtures.ciphertext = await readFile(path.join(directory, 'enrollment.bin'));
    protection.decrypt.mockClear();
  };
  return { root, executable, directory, protection, openLogin, create, seed };
}

it('fresh resume does not launch a helper or browser', async () => {
  const fixture = await setup(),
    owner = fixture.create();
  await owner.resume();
  expect(fixtures.spawn).not.toHaveBeenCalled();
  expect(fixture.openLogin).not.toHaveBeenCalled();
  await owner.close();
});

it('retries shutdown if the exact helper exit was not confirmed on the first close', async () => {
  const fixture = await setup();
  await fixture.seed();
  const owner = fixture.create();
  await owner.resume();
  fixtures.close.mockResolvedValueOnce(undefined);
  vi.useFakeTimers();
  const first = owner.close().catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5001);
  expect(await first).toMatchObject({ message: 'NETWORK_TIMEOUT' });
  await owner.close();
  expect(fixtures.close).toHaveBeenCalledTimes(2);
});

it('retains a helper whose initial enrollment open and cleanup both fail', async () => {
  const fixture = await setup();
  fixtures.ready.mockRejectedValue(Error('NETWORK_STORAGE_BUSY'));
  fixtures.close.mockRejectedValueOnce(Error('NETWORK_COMPONENT_FAILED'));
  const owner = fixture.create();
  vi.useFakeTimers();
  const connecting = owner.command({ action: 'connect' });
  await vi.waitFor(() => expect(fixtures.close).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5001);
  await connecting;
  await owner.close();
  expect(fixtures.close).toHaveBeenCalledTimes(2);
  expect(fixtures.spawn).toHaveBeenCalledOnce();
});

it('disabled enrollment is decrypted only after helper readiness and survives shutdown/reopen unchanged', async () => {
  const fixture = await setup();
  await fixture.seed();
  const original = Buffer.from(fixtures.ciphertext!);
  fixtures.ready.mockImplementation(() => {
    expect(fixture.protection.decrypt).not.toHaveBeenCalled();
    return Promise.resolve();
  });
  const first = fixture.create();
  await first.resume();
  await first.close();
  expect(fixtures.ciphertext).toEqual(original);
  fixture.protection.decrypt.mockClear();
  const second = fixture.create();
  await second.resume();
  await second.close();
  expect(fixtures.spawn).toHaveBeenCalledTimes(2);
  expect(fixture.protection.decrypt).toHaveBeenCalledOnce();
  expect(fixtures.command).not.toHaveBeenCalled();
  expect(fixture.openLogin).not.toHaveBeenCalled();
  expect(await readFile(path.join(fixture.directory, 'enrollment.bin'))).toEqual(original);
});

it('helper lease failure never decrypts enrollment or opens login', async () => {
  const fixture = await setup();
  await fixture.seed();
  fixtures.ready.mockRejectedValue(Error('NETWORK_STORAGE_BUSY'));
  const owner = fixture.create();
  await owner.resume();
  expect(fixture.protection.decrypt).not.toHaveBeenCalled();
  expect(fixture.openLogin).not.toHaveBeenCalled();
  expect(owner.snapshot().state).toBe('failed');
  await owner.close();
});

it('corrupt protected enrollment fails closed without replacing its ciphertext', async () => {
  const fixture = await setup();
  await fixture.seed();
  const original = Buffer.from('corrupt enrollment');
  fixtures.ciphertext = original;
  const owner = fixture.create();
  await owner.resume();
  expect(owner.snapshot().error).toBe('NETWORK_STORAGE_UNAVAILABLE');
  expect(fixtures.ciphertext).toEqual(original);
  expect(fixtures.command).not.toHaveBeenCalled();
  expect(fixture.openLogin).not.toHaveBeenCalled();
  await owner.close();
});

it('explicit sign-out can clear unreadable enrollment under the helper lease', async () => {
  const fixture = await setup();
  await fixture.seed();
  fixtures.ciphertext = Buffer.from('unreadable enrollment');
  const owner = fixture.create();
  await owner.resume();
  expect(owner.snapshot().error).toBe('NETWORK_STORAGE_UNAVAILABLE');
  await owner.command({ action: 'sign-out' });
  expect(owner.snapshot().state).toBe('disconnected');
  expect(fixture.openLogin).not.toHaveBeenCalled();
  const cleared = JSON.parse(fixtures.ciphertext.toString()) as { values: object };
  expect(cleared.values).toEqual({});
  await owner.command({ action: 'connect' });
  expect(owner.snapshot().state).toBe('starting');
  expect(fixtures.command).toHaveBeenCalledWith('connect');
  await owner.close();
});

it.each(['encryption', 'replacement'] as const)(
  'failed sign-out %s preserves unreadable ciphertext for the next normal connect',
  async (failure) => {
    const fixture = await setup();
    await fixture.seed();
    const original = Buffer.from('unreadable enrollment');
    fixtures.ciphertext = original;
    const owner = fixture.create();
    await owner.resume();
    if (failure === 'encryption')
      fixture.protection.encrypt.mockImplementationOnce(() => {
        throw Error('NETWORK_STORAGE_UNAVAILABLE');
      });
    else fixtures.replace.mockRejectedValueOnce(Error('NETWORK_STORAGE_UNAVAILABLE'));
    await owner.command({ action: 'sign-out' });
    expect(owner.snapshot().error).toBe('NETWORK_SIGNOUT_INCOMPLETE');
    expect(fixtures.ciphertext).toEqual(original);
    await owner.command({ action: 'connect' });
    expect(owner.snapshot().error).toBe('NETWORK_STORAGE_UNAVAILABLE');
    expect(fixtures.ciphertext).toEqual(original);
    expect(fixtures.command).not.toHaveBeenCalledWith('connect');
    await owner.command({ action: 'sign-out' });
    expect(owner.snapshot().state).toBe('disconnected');
    await owner.close();
  },
);

it('tampered helper fails before spawn or protected storage access', async () => {
  const fixture = await setup();
  await fixture.seed();
  await writeFile(fixture.executable, 'tampered');
  const owner = fixture.create();
  await owner.resume();
  expect(owner.snapshot().error).toBe('NETWORK_COMPONENT_INVALID');
  expect(fixtures.spawn).not.toHaveBeenCalled();
  expect(fixture.protection.decrypt).not.toHaveBeenCalled();
  await owner.close();
});
it('does not inherit forced enrollment settings from the launching shell', async () => {
  const previous = process.env.TSNET_FORCE_LOGIN;
  process.env.TSNET_FORCE_LOGIN = '1';
  const fixture = await setup();
  const owner = fixture.create();
  try {
    await fixture.seed();
    await owner.resume();
    const options = fixtures.spawn.mock.calls[0]?.[2] as { env: Record<string, string> };
    expect(options.env).not.toHaveProperty('TSNET_FORCE_LOGIN');
  } finally {
    await owner.close();
    if (previous === undefined) delete process.env.TSNET_FORCE_LOGIN;
    else process.env.TSNET_FORCE_LOGIN = previous;
  }
});
