import { fileURLToPath } from 'node:url';
import type { OwnedEngine } from '../runtime/engine-adapter.js';
import type { Selection } from '../runtime/contracts.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';
import { createFixtureDeployment } from './fixture-engine.js';
import type { FixtureMode } from './fixture-engine.js';
import { decodeBroker, decodeReply, selectionKey } from './broker-protocol.js';
import { decodeObject, exact } from './control.js';

/** Captured Electron utility child. This capability is constructed by trusted main, never IPC. */
export interface UtilityChild {
  readonly pid?: number;
  postMessage(text: string): void;
  on(event: 'spawn' | 'exit' | 'message', listener: (...args: unknown[]) => void): void;
  kill(): boolean;
}
export type UtilityFork = (entry: string) => UtilityChild;
export interface DesktopFixtureHost {
  command(text: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
/** Main-owned development fixture host; containment precedes utility launch authority. */
export async function createDesktopFixtureHost(
  fork: UtilityFork,
  mode: FixtureMode = 'ready',
): Promise<DesktopFixtureHost> {
  const deployment = createFixtureDeployment();
  const adapter = deployment.adapter(mode);
  const began = Date.now();
  const utility = fork(fileURLToPath(new URL('../../tests/utility-entry.cjs', import.meta.url)));
  let alive = true;
  let closing: Promise<void> | undefined;
  let engine: { key: string; value: OwnedEngine } | undefined;
  let launching = false;
  let boot!: () => void;
  const booted = new Promise<void>((resolve) => {
    boot = resolve;
  });
  const pending = new Map<
    number,
    {
      resolve: (reply: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const send = (value: unknown) => {
    const text = JSON.stringify(value);
    if (!alive || Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error('CORE_EXITED');
    utility.postMessage(text);
  };
  function close(): Promise<void> {
    closing ??= deployment.close();
    return closing;
  }
  const exit = new Promise<void>((resolve) =>
    utility.on('exit', () => {
      alive = false;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CORE_EXITED'));
      }
      pending.clear();
      void close().then(resolve, resolve);
    }),
  );
  const phase = (selection: Selection, state: string, code = 0) => {
    if (alive) send({ type: 'engine', phase: state, selection, code });
  };
  utility.on('message', (input) => {
    void (async () => {
      if (typeof input !== 'string') throw new Error('INVALID_CONTROL');
      const envelope = decodeObject(input);
      if (envelope.type === 'booted') {
        exact(envelope, ['type']);
        boot();
        return;
      }
      if (envelope.type === 'broker') {
        const command = decodeBroker(input);
        const key = selectionKey(command.selection);
        if (command.action === 'launch') {
          if (engine || launching) throw new Error('BUSY');
          launching = true;
          try {
            const instance = await adapter.launch(command.selection, new AbortController().signal);
            engine = { key, value: instance };
            phase(command.selection, 'captured');
            void instance
              .waitReady(new AbortController().signal)
              .then(
                () => phase(command.selection, 'ready'),
                () => undefined,
              )
              .catch(() => {
                utility.kill();
                void close().catch(() => undefined);
              });
            void instance.exited
              .then((receipt) => {
                if (engine?.key === key) engine = undefined;
                phase(command.selection, 'exited', receipt.code ?? 1);
              })
              .catch(() => {
                utility.kill();
                void close().catch(() => undefined);
              });
          } catch {
            phase(command.selection, 'failed');
          } finally {
            launching = false;
          }
        } else if (engine?.key === key) {
          if (command.action === 'stop') await engine.value.requestStop();
          else if (command.action === 'force') await engine.value.forceStop();
          else deployment.crash();
        }
        return;
      }
      exact(envelope, ['type', 'reply', 'quit']);
      if (envelope.type !== 'reply' || typeof envelope.quit !== 'boolean')
        throw new Error('INVALID_CONTROL');
      const reply = decodeReply(envelope.reply);
      if (typeof reply.id !== 'number') throw new Error('INVALID_CONTROL');
      const waiter = pending.get(reply.id);
      if (!waiter) return;
      pending.delete(reply.id);
      clearTimeout(waiter.timer);
      try {
        if (envelope.quit) {
          send({ type: 'exit' });
          await exit;
          await close();
        }
        waiter.resolve({
          ...reply,
          pids: deployment.children(),
          corePid: utility.pid ?? 0,
          quit: envelope.quit,
        });
      } catch {
        waiter.reject(new Error('CLEANUP_FAILED'));
      }
    })().catch(() => {
      utility.kill();
      void close().catch(() => undefined);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CORE_START_TIMEOUT')), 5_000);
      utility.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('CORE_EXITED'));
      });
      utility.on('spawn', () => {
        try {
          const pid = utility.pid;
          if (!pid) throw new Error('CORE_EXITED');
          deployment.admitCore(pid, process.execPath, began);
          void booted
            .then(() => {
              send({ type: 'admitted' });
              clearTimeout(timer);
              resolve();
            })
            .catch(reject);
        } catch {
          clearTimeout(timer);
          reject(new Error('OWNERSHIP_FAILED'));
        }
      });
    });
  } catch (error: unknown) {
    utility.kill();
    await close();
    throw error;
  }
  return {
    close,
    command(text) {
      let value: Record<string, unknown>;
      try {
        value = decodeObject(text);
      } catch {
        return Promise.resolve({ id: 0, error: 'INVALID_CONTROL', pids: deployment.children() });
      }
      if (
        typeof value.id !== 'number' ||
        !Number.isSafeInteger(value.id) ||
        value.id < 1 ||
        pending.has(value.id) ||
        pending.size >= 64
      )
        return Promise.resolve({ id: 0, error: 'INVALID_CONTROL', pids: deployment.children() });
      const id = value.id;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('CORE_TIMEOUT'));
          utility.kill();
          void close().catch(() => undefined);
        }, 185_000);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'command', text });
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
  };
}
