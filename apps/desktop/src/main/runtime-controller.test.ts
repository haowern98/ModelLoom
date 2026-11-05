import { expect, it, vi } from 'vitest';
import { createModelLoadingStatus } from './model-loading-status';
import path from 'node:path';
import * as module from './runtime-controller';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';
import {
  record,
  capabilities,
} from '../../../../packages/core/src/model-configuration/test-fixtures';
import type { PeerCommand, PeerReply, PeerView } from '../shared/peers';
import type { SavedClusterConfiguration } from '../../../../packages/core/src/cluster/contracts';

// The indexed runtime owner is Windows-only; retain its path contract on Linux CI too.
vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof path>();
  return {
    ...original,
    default: { ...original, resolve: (...parts: string[]) => original.win32.resolve(...parts) },
  };
});
const localDevice = {
  name: 'local-pc',
  os: 'Windows',
  cpuName: 'Local CPU',
  threads: 8,
  role: 'Worker' as const,
};
it('rejects unqualified speculation before native preparation or silent target-only loading', async () => {
  const { controller, host, deps } = setup(true, {}, true);
  Object.assign(host, {
    configuration: vi.fn(() =>
      Promise.resolve({
        ok: true,
        record: {
          ...record(),
          schemaVersion: 2,
          speculation: {
            version: 1,
            enabled: true,
            proposer: null,
            retrieval: { method: 'ngram-simple' },
          },
        },
        defaults: { ...record(), revision: 0 },
        pendingReload: false,
        maxOutputTokens: 512,
        thinkingSupported: false,
      }),
    ),
  });
  await controller.command({ action: 'import' });
  const snapshot = await controller.command({ action: 'snapshot' });
  if (!snapshot.model) throw Error('Expected indexed target');
  const before = host.command.mock.calls.length;
  const reply = await controller.command({ action: 'load', modelId: snapshot.model.id });
  expect(reply.error).toContain('verified speculative estimator');
  expect(host.command).toHaveBeenCalledTimes(before);
  expect(deps.preflight).not.toHaveBeenCalled();
  await controller.quit();
});
it('keeps an active model ready when an unevidenced saved configuration is rejected', async () => {
  const { controller, host } = setup();
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  if (!imported.model) throw Error('fixture model unavailable');
  expect((await controller.command({ action: 'load', modelId: imported.model.id })).phase).toBe(
    'ready',
  );
  const attempts = host.command.mock.calls.length;
  const rejected = await controller.command({
    action: 'run-configuration',
    configurationId: '12345678-1234-4234-8234-123456789abc',
    revision: 1,
  });
  expect(rejected.phase).toBe('ready');
  expect(rejected.error).toContain('verified for the selected runtime and GPUs');
  expect(host.command).toHaveBeenCalledTimes(attempts);
  await controller.quit();
});
function setup(enabled = true, overrides: Record<string, unknown> = {}, history = false) {
  let phase = 'stopped';
  const host = {
    command: vi.fn(
      (
        text: string,
      ): Promise<{
        snapshot: { phase: string; fault: { code: string; message: string } | null };
      }> => {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || !('action' in value))
          throw new Error('INVALID_CONTROL');
        if (value.action === 'load') phase = 'ready';
        if (value.action === 'stop' || value.action === 'quit') phase = 'stopped';
        return Promise.resolve({ snapshot: { phase, fault: null } });
      },
    ),
    close: vi.fn(() => Promise.resolve()),
  };
  const deps = {
    enabled,
    pick: vi.fn(() => Promise.resolve('private/path.gguf')),
    inspect: vi.fn(() => Promise.resolve({ sha256: 'a'.repeat(64), size: '3.80 GB' })),
    expectedHash: 'a'.repeat(64),
    packageId: 'package',
    preflight: vi.fn(() => Promise.resolve()),
    confirmSharedMemory: vi.fn(() => Promise.resolve(false)),
    createHost: vi.fn(() => Promise.resolve(host)),
    device: vi.fn(() => Promise.resolve(localDevice)),
  };
  Object.assign(deps, overrides);
  if (history) Object.assign(deps, { createHistoryHost: () => Promise.resolve(host) });
  const controller = Reflect.get(module, 'createRuntimeController')?.(deps);
  return { controller, host, deps };
}
it.each([
  [
    'CORE_START_TIMEOUT',
    'The library service did not start in time. Restart the app and try again.',
  ],
  [
    'LIBRARY_UNAVAILABLE',
    'The saved model library could not be opened. Restart the app and try again.',
  ],
])('distinguishes library startup failure %s from saved-data failure', async (code, expected) => {
  const { controller } = setup(true, {
    createHistoryHost: () => Promise.reject(new Error(code)),
  });
  await vi.waitFor(async () => {
    const view = await controller.command({ action: 'snapshot' });
    expect(view.restoring).toBe(false);
    expect(view.error).toBe(expected);
    expect(view.models).toEqual([]);
  });
  await controller.quit();
});

it.each([
  ['START_TIMEOUT', 'Startup deadline exceeded', 'Model loading timed out.'],
  ['ENGINE_EXITED', 'Owned engine exited', 'The model runtime exited unexpectedly.'],
  [
    'START_FAILED',
    'Engine startup failed (RPC_DISCONNECTED)',
    'The connection to the remote GPU closed during loading.',
  ],
])(
  'reports the observed failure %s instead of the generic startup popup',
  async (code, message, expected) => {
    const { controller, host } = setup();
    await controller.command({ action: 'import' });
    const imported = await controller.command({ action: 'snapshot' });
    host.command.mockImplementation((text: string) =>
      Promise.resolve({
        snapshot:
          (JSON.parse(text) as { action: string }).action === 'load'
            ? { phase: 'failed', fault: { code, message } }
            : { phase: 'stopped', fault: null },
      }),
    );
    const view = await controller.command({ action: 'load', modelId: imported.model!.id });
    expect(view.error).toContain(expected);
    await controller.quit();
  },
);
it('publishes only the current coalesced device scan to the peer owner', async () => {
  const updatePeerHardware = vi.fn((): Promise<void> => Promise.resolve());
  const { controller, deps } = setup(true, { updatePeerHardware });
  let release!: (device: typeof localDevice) => void;
  deps.device.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const before = controller.command({ action: 'snapshot' });
  await vi.waitFor(() => expect(deps.device).toHaveBeenCalledTimes(1));
  deps.device.mockResolvedValueOnce({ ...localDevice, cpuName: 'fresh CPU' });
  const changed = controller.deviceChanged();
  release(localDevice);
  await Promise.all([before, changed]);
  expect(updatePeerHardware).toHaveBeenCalledTimes(1);
  expect(updatePeerHardware).toHaveBeenCalledWith(
    expect.objectContaining({ cpuName: 'fresh CPU' }),
  );
  await controller.quit();
});

it('forwards peer changes without starting a model and unsubscribes on Quit', async () => {
  let changed!: () => void;
  const unsubscribe = vi.fn();
  const { controller, deps } = setup(true, {
    subscribePeers: (listener: () => void) => {
      changed = listener;
      return unsubscribe;
    },
  });
  const listener = vi.fn();
  const stop = controller.subscribePeers(listener);
  changed();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(deps.createHost).not.toHaveBeenCalled();
  stop();
  changed();
  expect(listener).toHaveBeenCalledTimes(1);
  await controller.quit();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

function remoteLoadSetup() {
  let changed!: (reply: PeerReply) => void;
  const f = setup(
    true,
    {
      subscribePeers: (listener: typeof changed) => {
        changed = listener;
        return () => undefined;
      },
    },
    true,
  );
  const fingerprint = 'b'.repeat(64);
  const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
  const saved: SavedClusterConfiguration = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Remote',
    revision: 1,
    modelId: 'a'.repeat(64),
    blockCount: 64,
    profileId: 'b11306-four-slot',
    load: {
      defaults: {
        automatic: false,
        contextLength: 7680,
        threads: null,
        evaluationBatch: 2048,
        physicalBatch: 512,
        concurrency: 4,
        flashAttention: true,
      },
      cacheK: 'q8_0',
      cacheV: 'q8_0',
    },
    runs: [{ uuid: `peer:${fingerprint}:${uuid}`, first: 0, last: 63 }],
  };
  const prepare = vi.fn((): Promise<void> => Promise.resolve());
  Object.assign(f.host, {
    configuration: () =>
      Promise.resolve({
        ok: true,
        record: record(),
        defaults: record(),
        pendingReload: false,
        maxOutputTokens: capabilities.maxOutputTokens,
        thinkingSupported: false,
      }),
    cluster: () => Promise.resolve({ ok: false, error: 'UNKNOWN_CONFIGURATION' }),
    prepareCluster: prepare,
  });
  Object.assign(f.deps, {
    planModel: () => Promise.resolve(saved),
    preflightCluster: () => Promise.resolve({}),
    inspect: () =>
      Promise.resolve({
        sha256: saved.modelId,
        size: '3.8 GB',
        contextLimit: 32768,
        blockCount: 64,
      }),
  });
  const update = (connected: boolean, memoryBytes = 12000) =>
    changed({
      ok: true,
      view: {
        fingerprint: 'a'.repeat(64),
        name: 'local',
        sharing: false,
        addresses: [],
        gpus: [],
        sharedGpuIds: [],
        incoming: [],
        outgoing: [
          {
            id: 'remote',
            name: 'ptss',
            peerFingerprint: fingerprint,
            phase: connected ? 'approved' : 'disconnected',
            localVerified: true,
            remoteVerified: true,
            gpus: connected ? [{ id: uuid, name: 'GPU', memoryBytes }] : [],
          },
        ],
      },
    });
  const load = async () => {
    await f.controller.command({ action: 'import' });
    return f.controller.command({ action: 'load', modelId: `model-${saved.modelId}` });
  };
  return {
    ...f,
    update,
    load,
    prepare,
    ownerExit: () => changed({ ok: false, error: 'CORE_EXITED' }),
  };
}

it('does not stop a local-only model for peer disconnects or malformed notifications', async () => {
  let changed!: (reply: PeerReply) => void;
  const f = setup(true, {
    subscribePeers: (listener: typeof changed) => {
      changed = listener;
      return () => undefined;
    },
  });
  await f.controller.command({ action: 'import' });
  const loaded = await f.controller.command({ action: 'load', modelId: `model-${'a'.repeat(64)}` });
  expect(loaded.phase).toBe('ready');
  f.host.command.mockClear();
  changed({ ok: false, error: 'PEER_UNAVAILABLE' });
  changed({ ok: false, error: 'CORE_EXITED' });
  changed({
    ok: true,
    view: {
      fingerprint: 'a'.repeat(64),
      name: 'local',
      sharing: false,
      addresses: [],
      gpus: [],
      sharedGpuIds: [],
      incoming: [],
      outgoing: [],
    },
  });
  expect(f.host.command).not.toHaveBeenCalled();
  expect((await f.controller.command({ action: 'snapshot' })).phase).toBe('ready');
  await f.controller.quit();
});

it('requires confirmation before disconnecting an active worker and stops the model before dispatch', async () => {
  const f = remoteLoadSetup();
  const peerView: PeerView = {
    fingerprint: 'a'.repeat(64),
    name: 'Local',
    sharing: false,
    addresses: [],
    gpus: [],
    sharedGpuIds: [],
    incoming: [],
    outgoing: [
      {
        id: 'remote',
        name: 'PTSS',
        peerFingerprint: 'b'.repeat(64),
        phase: 'approved',
        localVerified: true,
        remoteVerified: true,
        gpus: [],
      },
    ],
  };
  const peers = vi.fn((input: PeerCommand): Promise<PeerReply> => {
    if (input.action === 'disconnect') {
      expect(
        f.host.command.mock.calls.some(
          ([text]) => (JSON.parse(text) as { action: string }).action === 'stop',
        ),
      ).toBe(true);
    }
    return Promise.resolve({ ok: true, view: peerView });
  });
  Object.assign(f.deps, { peers });
  expect((await f.load()).phase).toBe('ready');
  f.host.command.mockClear();
  expect(await f.controller.peers({ action: 'disconnect', id: 'remote' })).toEqual({
    ok: false,
    error: 'PEER_IN_USE',
  });
  expect(f.host.command).not.toHaveBeenCalled();
  expect(peers.mock.calls.some(([input]) => input.action === 'disconnect')).toBe(false);
  expect(
    (await f.controller.peers({ action: 'disconnect', id: 'remote', stopModel: true })).ok,
  ).toBe(true);
  expect((await f.controller.command({ action: 'snapshot' })).phase).toBe('stopped');
  await f.controller.quit();
});

it.each(['disconnect', 'owner exit'])(
  'stops a peer-dependent owned model on %s but not memory-only changes',
  async (reason) => {
    const f = remoteLoadSetup();
    expect((await f.load()).phase).toBe('ready');
    f.host.command.mockClear();
    f.update(true, 11000);
    expect(f.host.command).not.toHaveBeenCalled();
    if (reason === 'disconnect') f.update(false);
    else f.ownerExit();
    await vi.waitFor(() => expect(f.host.command).toHaveBeenCalled());
    await vi.waitFor(async () =>
      expect((await f.controller.command({ action: 'snapshot' })).phase).toBe('failed'),
    );
    expect((await f.controller.command({ action: 'snapshot' })).error).toContain('disconnected');
    expect(
      f.host.command.mock.calls.some(
        ([text]) => (JSON.parse(text) as { action: string }).action === 'stop',
      ),
    ).toBe(true);
    await f.controller.quit();
  },
);

it('settles native preparation before stopping and never loads a lost peer allocation', async () => {
  const f = remoteLoadSetup();
  let release!: () => void;
  f.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const loading = f.load();
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  f.host.command.mockClear();
  f.update(false);
  expect(f.host.command).not.toHaveBeenCalled();
  release();
  expect((await loading).phase).toBe('failed');
  await vi.waitFor(() =>
    expect(
      f.host.command.mock.calls.some(
        ([text]) => (JSON.parse(text) as { action: string }).action === 'stop',
      ),
    ).toBe(true),
  );
  expect(
    f.host.command.mock.calls.some(
      ([text]) => (JSON.parse(text) as { action: string }).action === 'load',
    ),
  ).toBe(false);
  await f.controller.quit();
});
it('keeps peer management available before model startup and closes its independent owner on Quit', async () => {
  const { controller, deps } = setup();
  const peers = vi.fn(() => Promise.resolve({ ok: false, error: 'PEER_UNAVAILABLE' }));
  const closePeers = vi.fn(() => Promise.resolve());
  Object.assign(deps, { peers, closePeers });
  expect(await controller.peers({ action: 'read' })).toEqual({
    ok: false,
    error: 'PEER_UNAVAILABLE',
  });
  expect(peers).toHaveBeenCalledTimes(1);
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
  expect(closePeers).toHaveBeenCalledTimes(1);
});
it('retains peer GPU reservations until the model owner has confirmed shutdown', async () => {
  const { controller, host, deps } = setup();
  const order: string[] = [];
  Object.assign(deps, {
    beginPeerQuit: vi.fn(() => {
      order.push('admission');
      return Promise.resolve();
    }),
    closePeers: vi.fn(() => {
      order.push('peers');
      return Promise.resolve();
    }),
  });
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  if (!imported.model) throw Error('Fixture import failed');
  await controller.command({ action: 'load', modelId: imported.model.id });
  host.close.mockImplementationOnce(() => {
    order.push('model');
    return Promise.resolve();
  });
  await controller.quit();
  expect(order).toEqual(['admission', 'model', 'peers']);
});
it('closes the independent peer owner even when model shutdown fails', async () => {
  const { controller, host, deps } = setup();
  const closePeers = vi.fn(() => Promise.resolve());
  Object.assign(deps, { closePeers });
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  if (!imported.model) throw Error('Fixture import failed');
  await controller.command({ action: 'load', modelId: imported.model.id });
  host.close.mockRejectedValueOnce(new Error('CLEANUP_FAILED'));
  await expect(controller.quit()).rejects.toThrow('CLEANUP_FAILED');
  expect(closePeers).toHaveBeenCalledTimes(1);
});
it('waits for sharing to drain before closing its peer owner', async () => {
  const { controller, deps, host } = setup();
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  if (!imported.model) throw Error('Fixture import failed');
  await controller.command({ action: 'load', modelId: imported.model.id });
  let drained!: () => void;
  const closePeers = vi.fn(() => Promise.resolve());
  Object.assign(deps, {
    beginPeerQuit: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          drained = resolve;
        }),
    ),
    closePeers,
  });
  const closing = controller.quit();
  await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
  expect(closePeers).not.toHaveBeenCalled();
  drained();
  await closing;
  expect(closePeers).toHaveBeenCalledTimes(1);
});
it('shows this device before import or load, independently of role and runtime activation', async () => {
  const { controller, deps } = setup(false);
  const snapshot = await controller.command({ action: 'snapshot' });
  expect(snapshot.device).toEqual(localDevice);
  expect(snapshot.model).toBeNull();
  expect(snapshot.phase).toBe('stopped');
  expect(snapshot.enabled).toBe(false);
  expect(await controller.command({ action: 'snapshot' })).toEqual(snapshot);
  expect(deps.device).toHaveBeenCalledTimes(1);
  expect(deps.pick).not.toHaveBeenCalled();
  expect(deps.inspect).not.toHaveBeenCalled();
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
});

it('allows Quit after full peer cleanup confirms an earlier sharing drain failure is settled', async () => {
  const { controller, deps } = setup();
  const closePeers = vi.fn(async () => {});
  Object.assign(deps, {
    beginPeerQuit: vi.fn(() => Promise.reject(Error('RPC_CLEANUP_FAILED'))),
    closePeers,
  });
  await expect(controller.quit()).resolves.toBeUndefined();
  expect(closePeers).toHaveBeenCalledTimes(1);
});

it('blocks Quit if full peer cleanup remains unconfirmed after sharing drain failure', async () => {
  const { controller, deps } = setup();
  Object.assign(deps, {
    beginPeerQuit: vi.fn(() => Promise.reject(Error('RPC_CLEANUP_FAILED'))),
    closePeers: vi.fn(() => Promise.reject(Error('PEER_CLEANUP_FAILED'))),
  });
  await expect(controller.quit()).rejects.toThrow('PEER_CLEANUP_FAILED');
});
it('retries unavailable device information without reporting a model failure', async () => {
  const { controller, deps } = setup();
  deps.device.mockRejectedValueOnce(new Error('DEVICE_QUERY_FAILED'));
  const initial = await controller.command({ action: 'snapshot' });
  expect(initial.phase).toBe('stopped');
  expect(initial.error).toBeNull();
  expect(initial.device).toBeUndefined();
  expect((await controller.command({ action: 'snapshot' })).device).toEqual(localDevice);
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('refreshes expired memory observations without starting a model', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const { controller, deps } = setup(false);
    await controller.command({ action: 'snapshot' });
    clock.mockReturnValue(20001);
    deps.device.mockResolvedValueOnce({ ...localDevice, name: 'updated-host' });
    expect((await controller.command({ action: 'snapshot' })).device?.name).toBe('updated-host');
    expect(deps.device).toHaveBeenCalledTimes(2);
    expect(deps.createHost).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it('waits for an in-flight hardware query on Quit without starting an engine', async () => {
  const { controller, deps } = setup(false);
  let release!: (device: typeof localDevice) => void;
  deps.device.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const observing = controller.command({ action: 'snapshot' });
  await vi.waitFor(() => expect(deps.device).toHaveBeenCalledTimes(1));
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release(localDevice);
  await Promise.all([observing, closing]);
  expect(closed).toBe(true);
  expect(deps.createHost).not.toHaveBeenCalled();
});

it('refreshes immediately after a device-change notification despite the ten-second cache', async () => {
  const { controller, deps } = setup(false);
  await controller.command({ action: 'snapshot' });
  deps.device.mockResolvedValueOnce({ ...localDevice, name: 'GPU-disabled' });
  await controller.deviceChanged();
  expect((await controller.command({ action: 'snapshot' })).device?.name).toBe('GPU-disabled');
  expect(deps.device).toHaveBeenCalledTimes(2);
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
  await controller.deviceChanged();
  expect(deps.device).toHaveBeenCalledTimes(2);
});

it('discards a stale hardware scan and coalesces changes during it into one fresh scan', async () => {
  const { controller, deps } = setup(false);
  let release!: (device: typeof localDevice) => void;
  deps.device.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const before = controller.command({ action: 'snapshot' });
  await vi.waitFor(() => expect(deps.device).toHaveBeenCalledTimes(1));
  deps.device.mockResolvedValueOnce({ ...localDevice, name: 'new-hardware' });
  const firstChange = controller.deviceChanged();
  const secondChange = controller.deviceChanged();
  expect(deps.device).toHaveBeenCalledTimes(1);
  release(localDevice);
  await Promise.all([before, firstChange, secondChange]);
  expect((await controller.command({ action: 'snapshot' })).device?.name).toBe('new-hardware');
  expect(deps.device).toHaveBeenCalledTimes(2);
  await controller.quit();
});

it('does not confirm Quit if diagnostic child cleanup could not be confirmed', async () => {
  const { controller, deps } = setup(false);
  deps.device.mockRejectedValueOnce(new Error('QUERY_CLEANUP_FAILED'));
  await expect(controller.command({ action: 'snapshot' })).rejects.toThrow('QUERY_CLEANUP_FAILED');
  await expect(controller.quit()).rejects.toThrow('QUERY_CLEANUP_FAILED');
});
it('imports an opaque model, rejects forged IDs, and reports readiness only after the host confirms it', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  const imported = await controller.command({ action: 'import' });
  expect(imported.model!.id).toMatch(/^model-/u);
  expect(JSON.stringify(imported)).not.toContain('private/path');
  expect((await controller.command({ action: 'load', modelId: 'model-forged' })).error).toBe(
    'Select the imported model.',
  );
  expect(deps.createHost).not.toHaveBeenCalled();
  expect((await controller.command({ action: 'load', modelId: imported.model!.id })).phase).toBe(
    'ready',
  );
  expect((await controller.command({ action: 'stop' })).phase).toBe('stopped');
  await controller.quit();
});

it('indexes a different valid model hash and restores its source through the correct unloaded owner', async () => {
  const modelId = 'b'.repeat(64);
  let source: ModelSource | null = null;
  let lastUsedAt: number | null = null;
  let release!: (info: { sha256: string; size: string }) => void;
  const host = {
    command: vi.fn(() => Promise.resolve({ snapshot: { phase: 'stopped' } })),
    close: vi.fn(() => Promise.resolve()),
    api: vi.fn((_caller: string, input: unknown) => {
      const command = input as { action: string; source?: typeof source };
      if (command.action === 'readModelUsage')
        return Promise.resolve({ ok: true as const, lastUsedAt });
      if (command.action === 'readImportSource')
        return Promise.resolve({ ok: true as const, source });
      if (command.action === 'readLibraryEntry')
        return Promise.resolve({
          ok: true as const,
          entry:
            source && !(input as { after: string | null }).after ? { source, lastUsedAt } : null,
        });
      source = command.source ?? null;
      return Promise.resolve({ ok: true as const, registered: true as const });
    }),
  };
  const deps = {
    enabled: true as const,
    expectedHash: 'a'.repeat(64),
    packageId: 'package',
    pick: vi.fn(() => Promise.resolve(path.resolve('E:/Models', 'filename.gguf'))),
    inspect: vi.fn(
      () =>
        new Promise<{ sha256: string; size: string }>((resolve) => {
          release = resolve;
        }),
    ),
    preflight: vi.fn(),
    createHost: vi.fn(),
    createHistoryHost: vi.fn(() => Promise.resolve(host)),
    available: vi.fn(() => Promise.resolve(true)),
  };
  const controller = module.createRuntimeController(deps, 'window');
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(1));
  const pending = await controller.command({ action: 'snapshot' });
  expect(pending.indexing).toBe('filename.gguf');
  const privatePath = JSON.stringify(path.resolve('E:/Models', 'filename.gguf')).slice(1, -1);
  expect(JSON.stringify(pending)).not.toContain(privatePath);
  release({ sha256: modelId, size: '4 GB' });
  const imported = await importing;
  expect(imported.model?.name).toBe('filename.gguf');
  expect(deps.createHistoryHost).toHaveBeenCalledWith(
    expect.objectContaining({ modelId, file: path.resolve('E:/Models', 'filename.gguf') }),
  );
  expect(imported.model?.lastUsedAt).toBeUndefined();
  lastUsedAt = Date.now();
  const used = await controller.command({ action: 'snapshot' });
  expect(used.model?.lastUsedAt).toBe(lastUsedAt);
  expect(used.models?.[0]?.lastUsedAt).toBe(lastUsedAt);
  expect(source).not.toBeNull();
  await controller.quit();
  const reopened = module.createRuntimeController(deps, 'window');
  await vi.waitFor(async () =>
    expect((await reopened.command({ action: 'snapshot' })).restoring).toBe(false),
  );
  const restored = await reopened.command({ action: 'snapshot' });
  expect(restored.model?.id).toBe(`model-${modelId}`);
  expect(deps.createHistoryHost).toHaveBeenLastCalledWith(expect.objectContaining({ modelId }));
  expect(restored.phase).toBe('stopped');
  expect(restored.model?.unavailable).toBe(false);
  expect(restored.model?.lastUsedAt).toBe(lastUsedAt);
  expect(deps.inspect).toHaveBeenCalledTimes(1);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
  expect(JSON.stringify(restored)).not.toContain(privatePath);
  await reopened.quit();
  deps.available.mockResolvedValueOnce(false);
  const missing = module.createRuntimeController(deps, 'window');
  await vi.waitFor(async () =>
    expect((await missing.command({ action: 'snapshot' })).restoring).toBe(false),
  );
  expect((await missing.command({ action: 'snapshot' })).model?.unavailable).toBe(true);
  await missing.quit();
});

it('rechecks imported content before loading instead of trusting cached identity', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.inspect.mockResolvedValueOnce({ sha256: 'changed', size: '3.80 GB' });
  const result = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(result.phase).toBe('failed');
  expect(result.model?.unavailable).toBe(true);
  expect(result.models?.[0]?.id).toBe(imported.model!.id);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
});

it('blocks loading an old library entry while a replacement import is indexing', async () => {
  const { controller, deps } = setup();
  const initial = await controller.command({ action: 'import' });
  let release!: (info: { sha256: string; size: string }) => void;
  deps.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(2));
  const loading = await controller.command({ action: 'load', modelId: initial.model!.id });
  expect(loading.error).toContain('Stop the current model');
  expect(loading.phase).toBe('stopped');
  expect(deps.createHost).not.toHaveBeenCalled();
  release({ sha256: 'a'.repeat(64), size: '3.80 GB' });
  expect((await importing).phase).toBe('stopped');
  await controller.quit();
});

it('waits for indexing cleanup on Quit and never publishes its unfinished import', async () => {
  const { controller, deps } = setup();
  let release!: (info: { sha256: string; size: string }) => void;
  deps.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(1));
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release({ sha256: 'a'.repeat(64), size: '3.80 GB' });
  await Promise.all([importing, closing]);
  expect((await controller.command({ action: 'snapshot' })).model).toBeNull();
  expect(deps.createHost).not.toHaveBeenCalled();
});

it('can quit before file selection without waiting for the picker or starting inspection', async () => {
  const { controller, deps } = setup();
  let choose!: (file: string) => void;
  deps.pick.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        choose = resolve;
      }),
  );
  const importing = controller.command({ action: 'import' });
  await vi.waitFor(() => expect(deps.pick).toHaveBeenCalled());
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  try {
    await vi.waitFor(() => expect(closed).toBe(true));
  } finally {
    choose('private/path.gguf');
    await Promise.all([importing, closing]);
  }
  expect(deps.inspect).not.toHaveBeenCalled();
});

it('does not let a cancelled load inspection invalidate a newer imported entry', async () => {
  const { controller, deps } = setup();
  const initial = await controller.command({ action: 'import' });
  let reject!: (error: Error) => void;
  deps.inspect.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectInspection) => {
        reject = rejectInspection;
      }),
  );
  const loading = controller.command({ action: 'load', modelId: initial.model!.id });
  await vi.waitFor(() => expect(deps.inspect).toHaveBeenCalledTimes(2));
  await controller.command({ action: 'stop' });
  await controller.command({ action: 'import' });
  reject(new Error('OLD_FILE_UNAVAILABLE'));
  const result = await loading;
  expect(result.phase).toBe('stopped');
  expect(result.model?.unavailable).toBe(false);
  expect(deps.createHost).not.toHaveBeenCalled();
  await controller.quit();
});
it('keeps resource rejection honest, launches nothing, and allows an explicit retry', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  const view = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  const failed = await controller.command({ action: 'load', modelId: view.model!.id });
  expect(failed.phase).toBe('failed');
  expect(failed.error).toContain('RAM or GPU memory');
  expect(deps.createHost).not.toHaveBeenCalled();
  expect((await controller.command({ action: 'load', modelId: view.model!.id })).phase).toBe(
    'ready',
  );
  await controller.quit();
});
it('denies paths and mismatched GGUFs without forwarding them to a host', async () => {
  const { controller, deps } = setup();
  expect(controller).toBeDefined();
  await expect(controller.command({ action: 'import', path: 'anything' })).rejects.toThrow(
    'INVALID_CONTROL',
  );
  expect(deps.pick).not.toHaveBeenCalled();
  deps.inspect.mockResolvedValueOnce({ sha256: 'different', size: '1 GB' });
  expect((await controller.command({ action: 'import' })).error).toBeTruthy();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('explains rejected model file ownership without disclosing its path or starting an engine', async () => {
  const { controller, deps } = setup();
  deps.inspect.mockRejectedValueOnce(new Error('OWNERSHIP_FAILED'));

  const rejected = await controller.command({ action: 'import' });

  expect(rejected.phase).toBe('failed');
  expect(rejected.model).toBeNull();
  expect(rejected.error).toContain('standalone copy');
  expect(JSON.stringify(rejected)).not.toContain('private/path');
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('keeps a rejected retry visible even when an existing core is stopped', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  await controller.command({ action: 'stop' });
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  const failed = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(await controller.command({ action: 'snapshot' })).toEqual(failed);
  await controller.quit();
});
it('cancels shared-memory loading before host creation when the warning is declined', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const result = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(deps.confirmSharedMemory).toHaveBeenCalledTimes(1);
  expect(result.phase).toBe('stopped');
  expect(result.error).toBeNull();
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('rechecks resources after shared-memory confirmation before starting the model', async () => {
  const { controller, deps, host } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.confirmSharedMemory.mockResolvedValueOnce(true);
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const result = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(result.phase).toBe('ready');
  expect(deps.preflight).toHaveBeenNthCalledWith(2, true);
  expect(host.command.mock.calls.some(([text]) => text.includes('"action":"load"'))).toBe(true);
  await controller.quit();
});
it('does not reuse a pending confirmation after Stop or bypass a fresh RAM shortage', async () => {
  const { controller, deps } = setup();
  const imported = await controller.command({ action: 'import' });
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  let confirm!: (value: boolean) => void;
  deps.confirmSharedMemory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const loading = controller.command({ action: 'load', modelId: imported.model!.id });
  await vi.waitFor(() => expect(deps.confirmSharedMemory).toHaveBeenCalledTimes(1));
  await controller.command({ action: 'stop' });
  confirm(true);
  expect((await loading).phase).toBe('stopped');
  expect(deps.createHost).not.toHaveBeenCalled();
  deps.preflight.mockRejectedValueOnce(new Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  deps.preflight.mockRejectedValueOnce(new Error('INSUFFICIENT_RESOURCES'));
  deps.confirmSharedMemory.mockResolvedValueOnce(true);
  expect(
    (await controller.command({ action: 'load', modelId: imported.model!.id })).error,
  ).toContain('Not enough');
  expect(deps.createHost).not.toHaveBeenCalled();
});
it('preserves real readiness after rejecting a duplicate command', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  const duplicate = await controller.command({ action: 'load', modelId: imported.model!.id });
  expect(duplicate.phase).toBe('ready');
  expect(duplicate.error).toContain('Stop the current model');
  expect(host.command.mock.calls.filter(([text]) => text.includes('"action":"load"'))).toHaveLength(
    1,
  );
  await controller.quit();
});
it('waits for preparation on Quit and never loads after admission closes', async () => {
  const { controller, host, deps } = setup();
  let release!: (value: typeof host) => void;
  deps.createHost.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const imported = await controller.command({ action: 'import' });
  const loading = controller.command({ action: 'load', modelId: imported.model!.id });
  await vi.waitFor(() => expect(deps.createHost).toHaveBeenCalled());
  let closed = false;
  const closing = controller.quit().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release(host);
  await Promise.all([loading, closing]);
  expect(host.command.mock.calls.some(([text]) => text.includes('"action":"load"'))).toBe(false);
  expect(host.close).toHaveBeenCalledTimes(1);
  expect((await controller.command({ action: 'snapshot' })).phase).toBe('stopped');
});

it('joins owner confirmation before Quit completes when the core has exited', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  host.command.mockRejectedValueOnce(new Error('CORE_EXITED'));
  let confirm!: () => void;
  host.close.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        confirm = resolve;
      }),
  );
  let settled = false;
  const outcome = controller.quit().then(
    () => {
      settled = true;
    },
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
  expect(settled).toBe(false);
  confirm();
  await expect(outcome).resolves.toBeUndefined();
  expect(settled).toBe(true);
});

it('rejects Quit after core exit when owner cleanup cannot be confirmed', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  host.command.mockRejectedValueOnce(new Error('CORE_EXITED'));
  host.close.mockRejectedValueOnce(new Error('CLEANUP_FAILED'));
  await expect(controller.quit()).rejects.toThrow('CLEANUP_FAILED');
});

it('does not turn other broker failures into successful Quit', async () => {
  const { controller, host } = setup();
  const imported = await controller.command({ action: 'import' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  host.command.mockRejectedValueOnce(new Error('INVALID_CONTROL'));
  await expect(controller.quit()).rejects.toThrow('INVALID_CONTROL');
  expect(host.close).not.toHaveBeenCalled();
});

function popupSetup() {
  const fixture = setup();
  const { confirmSharedMemory: _unused, ...deps } = fixture.deps;
  void _unused;
  return { ...fixture, controller: module.createRuntimeController(deps) };
}
async function pendingMemoryWarning(f: ReturnType<typeof popupSetup>) {
  const imported = await f.controller.command({ action: 'import' });
  f.deps.preflight.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const loading = f.controller.command({ action: 'load', modelId: imported.model!.id });
  let warningId = '';
  await vi.waitFor(async () => {
    const warning = (await f.controller.command({ action: 'snapshot' })).memoryWarning;
    expect(warning).toBeTruthy();
    warningId = warning!.id;
  });
  return { loading, warningId, modelId: imported.model!.id };
}
it('ignores mismatched popup decisions and cancels without preparing an engine', async () => {
  const f = popupSetup();
  const pending = await pendingMemoryWarning(f);
  await f.controller.command({
    action: 'memory-decision',
    id: '22222222-2222-4222-8222-222222222222',
    loadAnyway: true,
  });
  expect((await f.controller.command({ action: 'snapshot' })).memoryWarning?.id).toBe(
    pending.warningId,
  );
  expect(f.deps.createHost).not.toHaveBeenCalled();
  await f.controller.command({
    action: 'memory-decision',
    id: pending.warningId,
    loadAnyway: false,
  });
  expect((await pending.loading).phase).toBe('stopped');
  expect(f.deps.createHost).not.toHaveBeenCalled();
  await f.controller.quit();
});
it('requires fresh popup permission and reruns preflight for Load anyway', async () => {
  const f = popupSetup();
  const pending = await pendingMemoryWarning(f);
  await f.controller.command({
    action: 'memory-decision',
    id: pending.warningId,
    loadAnyway: true,
  });
  expect((await pending.loading).phase).toBe('ready');
  expect(f.deps.preflight).toHaveBeenNthCalledWith(2, true);
  await f.controller.command({ action: 'stop' });
  f.deps.preflight.mockRejectedValueOnce(Error('SHARED_GPU_MEMORY_CONFIRMATION'));
  const second = f.controller.command({ action: 'load', modelId: pending.modelId });
  await vi.waitFor(async () =>
    expect((await f.controller.command({ action: 'snapshot' })).memoryWarning).toBeTruthy(),
  );
  const newId = (await f.controller.command({ action: 'snapshot' })).memoryWarning!.id;
  expect(newId).not.toBe(pending.warningId);
  await f.controller.command({
    action: 'memory-decision',
    id: pending.warningId,
    loadAnyway: true,
  });
  expect((await f.controller.command({ action: 'snapshot' })).memoryWarning?.id).toBe(newId);
  await f.controller.command({ action: 'memory-decision', id: newId, loadAnyway: false });
  await second;
  await f.controller.quit();
});
it.each(['stop', 'quit'] as const)(
  'cancels pending memory popup on %s without renderer response',
  async (action) => {
    const f = popupSetup();
    const pending = await pendingMemoryWarning(f);
    if (action === 'quit') await f.controller.quit();
    else await f.controller.command({ action: 'stop' });
    await pending.loading;
    expect(f.deps.createHost).not.toHaveBeenCalled();
    if (action !== 'quit') await f.controller.quit();
  },
);

it('publishes app-observed loading stages during an outstanding load and clears them after readiness', async () => {
  const status = createModelLoadingStatus();
  const { controller, host } = setup(true, { loadingStatus: status });
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  let finish!: () => void;
  let phase = 'stopped';
  host.command.mockImplementation((text: string) => {
    const action = (JSON.parse(text) as { action: string }).action;
    if (action === 'load') {
      phase = 'loading';
      status.observe('load.begin model=test.gguf context=128 slots=1 speculation=off');
      return new Promise((resolve) => {
        finish = () => {
          phase = 'ready';
          resolve({ snapshot: { phase, fault: null } });
        };
      });
    }
    if (action === 'stop') phase = 'stopped';
    return Promise.resolve({ snapshot: { phase, fault: null } });
  });
  const pending = controller.command({ action: 'load', modelId: imported.model!.id });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((await controller.command({ action: 'snapshot' })).loadingStage).toBe(1);
  status.observe('native.captured pid=123');
  expect((await controller.command({ action: 'snapshot' })).loadingStage).toBe(4);
  finish();
  expect((await pending).loadingStage).toBeUndefined();
  await controller.quit();
});

it('keeps the loaded engine running after choosing a runtime and activates it on the next load', async () => {
  const baseline = {
    packageId: 'package',
    version: 'b11306',
    artifact: 'baseline',
    backend: 'cuda',
    platform: 'win32',
    architecture: 'x64',
    upstreamCommit: 'a'.repeat(40),
  };
  const newer = { ...baseline, packageId: 'next-package', version: 'b11307', artifact: 'next' };
  let selected = baseline;
  const activateRuntime = vi.fn(() => Promise.resolve(selected));
  const selectRuntime = vi.fn(() => {
    selected = newer;
    return Promise.resolve(selected);
  });
  const { controller, host } = setup(true, {
    clusterArtifact: baseline.artifact,
    runtimeSelection: () => Promise.resolve(selected),
    runtimeInventory: () =>
      Promise.resolve({
        selected,
        installed: true,
        choices: [
          { id: 'b11306', build: baseline },
          { id: 'b11307', build: newer },
        ],
      }),
    selectRuntime,
    activateRuntime,
  });
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  if (!imported.model) throw Error('Expected imported model');
  await controller.command({ action: 'load', modelId: imported.model.id });
  const commands = host.command.mock.calls.length;
  const changed = await controller.command({ action: 'select-runtime', build: 'b11307' });
  expect(changed.phase).toBe('ready');
  expect(changed.selectedRuntime).toEqual(newer);
  expect(selectRuntime).toHaveBeenCalledWith('b11307');
  expect(activateRuntime).not.toHaveBeenCalled();
  expect(host.command).toHaveBeenCalledTimes(commands);
  await controller.command({ action: 'stop' });
  await controller.command({ action: 'load', modelId: imported.model.id });
  expect(activateRuntime).toHaveBeenCalledOnce();
  expect(host.close).toHaveBeenCalledOnce();
  expect(host.command).toHaveBeenCalledWith(expect.stringContaining('"action":"quit"'), true);
  await controller.quit();
});

it('waits for a runtime owner replacement before polling its snapshot', async () => {
  let finish!: () => void;
  const replacement = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closing = false;
  const baseline = { packageId: 'package', artifact: 'baseline' };
  const changed = { packageId: 'next-package', artifact: 'next' };
  let selected = baseline;
  const { controller, host } = setup(true, {
    clusterArtifact: baseline.artifact,
    runtimeSelection: () => Promise.resolve(selected),
    selectRuntime: () => Promise.resolve((selected = changed)),
    activateRuntime: () => Promise.resolve(changed),
  });
  await controller.command({ action: 'import' });
  const imported = await controller.command({ action: 'snapshot' });
  await controller.command({ action: 'load', modelId: imported.model!.id });
  await controller.command({ action: 'stop' });
  const original = host.command.getMockImplementation()!;
  host.command.mockImplementation((input) => {
    if (closing) return Promise.reject(Error('START_FAILED'));
    return original(input);
  });
  host.close.mockImplementation(async () => {
    closing = true;
    await replacement;
    closing = false;
  });
  const switching = controller.command({ action: 'select-runtime', build: 'b11306-vulkan' });
  await vi.waitFor(() => expect(host.close).toHaveBeenCalledOnce());
  const polling = controller.command({ action: 'snapshot' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  finish();
  expect((await switching).error).toBeNull();
  expect((await polling).error).toBeNull();
  await controller.quit();
});
