import type { EngineAdapter, OwnedEngine } from '../runtime/engine-adapter.js';
import type { Selection } from '../runtime/contracts.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';
import { decodeObject, exact } from './control.js';
import { decodeEngine, selectionFrom, selectionKey } from './broker-protocol.js';
import { fixtureSession } from './session.js';

export interface UtilityChannel {
  send(text: string): void;
  receive(handler: (text: unknown) => void): void;
  exit(code: number): void;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
/** Fixture utility host: shared policy, no native handles and no renderer channel. */
export function runUtility(channel: UtilityChannel): void {
  let admitted = false;
  const entries = new Map<
    string,
    {
      selection: Selection;
      captured: ReturnType<typeof deferred<OwnedEngine>>;
      ready: ReturnType<typeof deferred<void>>;
      exited: ReturnType<typeof deferred<{ code: number; signal: null }>>;
    }
  >();
  const send = (value: unknown) => {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error('INVALID_CONTROL');
    channel.send(text);
  };
  const adapter: EngineAdapter = {
    launch(input, abort) {
      const selection = selectionFrom(input);
      const key = selectionKey(selection);
      if (!admitted || abort.aborted || entries.has(key))
        return Promise.reject(new Error('START_FAILED'));
      const entry = {
        selection,
        captured: deferred<OwnedEngine>(),
        ready: deferred<void>(),
        exited: deferred<{ code: number; signal: null }>(),
      };
      entries.set(key, entry);
      send({ type: 'broker', action: 'launch', selection });
      return entry.captured.promise;
    },
  };
  const session = fixtureSession(
    adapter,
    () => {
      const selection = session.core.snapshot().selection;
      if (selection) send({ type: 'broker', action: 'crash', selection });
    },
    () => channel.exit(23),
  );
  channel.receive((input) => {
    try {
      if (typeof input !== 'string') throw new Error('INVALID_CONTROL');
      const envelope = decodeObject(input);
      if (envelope.type === 'admitted') {
        exact(envelope, ['type']);
        if (admitted) throw new Error('INVALID_CONTROL');
        admitted = true;
        return;
      }
      if (envelope.type === 'exit') {
        exact(envelope, ['type']);
        if (session.core.snapshot().phase !== 'stopped') throw new Error('INVALID_CONTROL');
        channel.exit(0);
        return;
      }
      if (envelope.type === 'engine') {
        const event = decodeEngine(input);
        const entry = entries.get(selectionKey(event.selection));
        if (!entry) return; // Late receipts cannot settle a newer load.
        switch (event.phase) {
          case 'captured':
            entry.captured.resolve({
              selection: entry.selection,
              exited: entry.exited.promise,
              waitReady(signal) {
                if (signal.aborted) return Promise.reject(new Error('START_FAILED'));
                return new Promise<void>((resolve, reject) => {
                  const cancel = () => {
                    signal.removeEventListener('abort', cancel);
                    reject(new Error('START_FAILED'));
                  };
                  signal.addEventListener('abort', cancel, { once: true });
                  void entry.ready.promise
                    .then(resolve, reject)
                    .finally(() => signal.removeEventListener('abort', cancel));
                });
              },
              requestStop() {
                send({ type: 'broker', action: 'stop', selection: entry.selection });
                return Promise.resolve();
              },
              forceStop() {
                send({ type: 'broker', action: 'force', selection: entry.selection });
                return Promise.resolve();
              },
            });
            break;
          case 'ready':
            entry.ready.resolve();
            break;
          case 'exited':
            entry.ready.reject(new Error('ENGINE_EXITED'));
            entry.exited.resolve({ code: event.code, signal: null });
            entries.delete(selectionKey(event.selection));
            break;
          case 'failed':
            entry.captured.reject(new Error('START_FAILED'));
            entry.ready.reject(new Error('START_FAILED'));
            entries.delete(selectionKey(event.selection));
            break;
        }
        return;
      }
      if (!admitted) throw new Error('INVALID_CONTROL');
      exact(envelope, ['type', 'text']);
      if (envelope.type !== 'command' || typeof envelope.text !== 'string')
        throw new Error('INVALID_CONTROL');
      void session
        .handle(envelope.text)
        .then(({ reply, quit }) => send({ type: 'reply', reply, quit }))
        .catch(() => channel.exit(1));
    } catch {
      channel.exit(1);
    }
  });
  send({ type: 'booted' });
}
