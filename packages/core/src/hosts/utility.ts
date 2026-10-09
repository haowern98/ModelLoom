import type { EngineAdapter, OwnedEngine } from '../runtime/engine-adapter.js';
import type { Selection } from '../runtime/contracts.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';
import { decodeObject, exact } from './control.js';
import { decodeEngine, selectionFrom, selectionKey } from './broker-protocol.js';
import { FIXTURE_SCOPE } from './broker-protocol.js';
import { fixtureSession } from './session.js';
import { ChatController } from '../generation/chat-controller.js';
import { UtilityChatTransport } from './chat-channel.js';
import { openHistoryStore } from '../history/store.js';
import type { HistoryStore, Provenance } from '../history/store.js';
import { trustedHistoryRoot } from '../history/windows-directory.js';

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
/** Utility core host: lifecycle, protected history and admission; no engine credentials or renderer channel. */
export function runUtility(channel: UtilityChannel, injectedHistory?: HistoryStore): void {
  let admitted = false;
  let scope = FIXTURE_SCOPE;
  let chat: ChatController | undefined, remote: UtilityChatTransport | undefined;
  let historyOwner: Awaited<ReturnType<typeof openHistoryStore>> | undefined;
  let chatPreparation: Promise<void> | undefined;
  let generationId = 0;
  let chatEpoch = 0;
  let provenance: Provenance | undefined;
  let lastChat = 0,
    quitting = false,
    dirty = false;
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
      const selection = selectionFrom(input, scope);
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
  let session = fixtureSession(
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
      if (envelope.type === 'generation-result') {
        remote?.receive(envelope);
        return;
      }
      if (envelope.type === 'chat-command') {
        exact(envelope, ['type', 'id', 'caller', 'command']);
        if (
          !admitted ||
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          envelope.id <= lastChat ||
          typeof envelope.caller !== 'string'
        )
          throw new Error('INVALID_CONTROL');
        lastChat = envelope.id;
        dirty = false;
        const caller = envelope.caller;
        const reply = (chatPreparation ?? Promise.resolve())
          .catch(() => undefined)
          .then(() =>
            !quitting && chat
              ? chat.command(caller, envelope.command)
              : {
                  ok: false,
                  error: !quitting && chatPreparation ? 'HISTORY_UNAVAILABLE' : 'NOT_READY',
                },
          );
        void reply
          .then((value) => send({ type: 'chat-reply', id: envelope.id, reply: value }))
          .catch(() => channel.exit(1));
        return;
      }
      if (envelope.type === 'admitted') {
        exact(envelope, [
          'type',
          'deploymentId',
          'packageId',
          'modelId',
          ...(envelope.chat === undefined ? [] : ['chat']),
        ]);
        if (admitted) throw new Error('INVALID_CONTROL');
        if (typeof envelope.deploymentId !== 'string') throw new Error('INVALID_CONTROL');
        const admittedSelection = selectionFrom(
          {
            deploymentId: envelope.deploymentId,
            packageId: envelope.packageId,
            modelId: envelope.modelId,
            sessionId: 'admission',
            operationId: 'admission',
          },
          {
            deploymentId: envelope.deploymentId,
            packageId: String(envelope.packageId),
            modelId: String(envelope.modelId),
          },
        );
        scope = {
          deploymentId: admittedSelection.deploymentId,
          packageId: admittedSelection.packageId,
          modelId: admittedSelection.modelId,
        };
        session = fixtureSession(
          adapter,
          () => {
            const selection = session.core.snapshot().selection;
            if (selection) send({ type: 'broker', action: 'crash', selection });
          },
          () => channel.exit(23),
          envelope.deploymentId,
        );
        admitted = true;
        if (envelope.chat !== undefined) {
          const setup = decodeObject(JSON.stringify(envelope.chat));
          exact(setup, ['applicationData', 'caller', 'provenance']);
          if (
            typeof setup.applicationData !== 'string' ||
            typeof setup.caller !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,128}$/u.test(setup.caller)
          )
            throw new Error('INVALID_CONTROL');
          provenance = setup.provenance as Provenance;
          const caller = setup.caller,
            applicationData = setup.applicationData;
          chatPreparation = (async () => {
            if (!injectedHistory)
              historyOwner = await openHistoryStore(trustedHistoryRoot(applicationData));
            const history = injectedHistory ?? historyOwner?.store;
            if (!history) throw new Error('HISTORY_UNAVAILABLE');
            chat = new ChatController(history, caller, () => {
              if (!dirty) {
                dirty = true;
                send({ type: 'chat-changed' });
              }
            });
          })();
          void chatPreparation.catch(() => undefined);
        }
        return;
      }
      if (envelope.type === 'exit') {
        exact(envelope, ['type']);
        if (session.core.snapshot().phase !== 'stopped') throw new Error('INVALID_CONTROL');
        channel.exit(0);
        return;
      }
      if (envelope.type === 'engine') {
        const event = decodeEngine(input, scope);
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
          case 'ready': {
            const epoch = chatEpoch;
            void (async () => {
              await chatPreparation?.catch(() => undefined);
              if (
                quitting ||
                epoch !== chatEpoch ||
                entries.get(selectionKey(event.selection)) !== entry
              ) {
                entry.ready.resolve();
                return;
              }
              if (chat && provenance) {
                remote = new UtilityChatTransport(entry.selection, send, () => ++generationId);
                try {
                  await chat.bind({
                    session: {
                      deploymentId: entry.selection.deploymentId,
                      sessionId: entry.selection.sessionId,
                      operationId: entry.selection.operationId,
                    },
                    provenance,
                    transport: remote,
                    cleanup: () => {
                      send({ type: 'broker', action: 'stop', selection: entry.selection });
                      return Promise.resolve();
                    },
                  });
                } catch {
                  remote?.close();
                }
              }
              entry.ready.resolve();
            })().catch(() => channel.exit(1));
            break;
          }
          case 'exited':
            chatEpoch++;
            remote?.close();
            void chat?.bind(null).catch(() => channel.exit(1));
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
      const command = decodeObject(envelope.text);
      const handle = async () => {
        if (command.action === 'quit') quitting = true;
        if (command.action === 'quit' || command.action === 'stop') chatEpoch++;
        await chatPreparation?.catch(() => undefined);
        if (command.action === 'quit' || command.action === 'stop') await chat?.bind(null);
        const reply = await session.handle(envelope.text as string);
        if (reply.quit) {
          await chat?.close();
          remote?.close();
          historyOwner?.close();
        }
        return reply;
      };
      void handle()
        .then(({ reply, quit }) => send({ type: 'reply', reply, quit }))
        .catch(() => channel.exit(1));
    } catch {
      channel.exit(1);
    }
  });
  send({ type: 'booted' });
}
