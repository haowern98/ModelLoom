import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { ModelConfigurationStore } from '../model-configuration/store.js';
import type * as StoreModule from '../model-configuration/store.js';
import { HistoryStore } from '../history/store.js';
import { record, capabilities } from '../model-configuration/test-fixtures.js';
import { captureClusterDraft } from '../cluster/run-plan.js';
import { runUtility } from './utility.js';
import { OwnerChatChannel } from './chat-channel.js';
import { qualifyPeerGpu } from '../cluster/device-id.js';

const state = vi.hoisted((): { owner: unknown } => ({ owner: undefined }));
vi.mock('../model-configuration/store.js', async (original) => ({
  ...(await original<typeof StoreModule>()),
  openModelConfigurationStore: () => state.owner,
}));
vi.mock('../history/windows-directory.js', () => ({ trustedHistoryRoot: () => ({}) }));
vi.mock('../model-configuration/windows-protection.js', () => ({
  windowsApiKeyProtection: () => {
    throw Error('CREDENTIAL_UNAVAILABLE');
  },
}));

it.each([
  'valid',
  'stale',
  'forged-allocation',
  'wrong-model',
  'named-current',
  'named-stale-settings',
  'remote-chat',
] as const)('checks protected draft intent before broker launch: %s', async (mode) => {
  const database = new DatabaseSync(':memory:');
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    { ...capabilities, profileId: 'b11306-four-slot' },
    record().load,
  );
  state.owner = { store, close: () => {} };
  const modelId = record().modelId;
  if (mode === 'remote-chat') {
    const original = await store.read(modelId);
    await store.save(modelId, original.revision, {
      ...original,
      load: { ...original.load, contextLength: 7401 },
    });
  }
  const gpu = 'GPU-12345678-1234-1234-1234-123456789abc';
  await store.recordImport(modelId, 123, {
    modelId,
    file: 'E:\\Models\\fixture.gguf',
    name: 'Fixture',
    size: '4 GB',
    sizeBytes: 4000,
    modifiedMs: 1,
    architecture: 'llama',
    contextLimit: 32768,
    blockCount: 64,
    quantization: 'Q4_K_M',
    parameters: '4B',
  });
  const draft = store.cluster.writeDraft(`model:${modelId}`, null, {
    modelId,
    load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
    runs: [
      {
        uuid: mode === 'remote-chat' ? qualifyPeerGpu('b'.repeat(64), gpu) : gpu,
        first: '0',
        last: '63',
      },
    ],
  });
  let captured = captureClusterDraft(
    draft,
    draft.revision,
    64,
    'b11306-four-slot',
    '12345678-1234-4234-8234-123456789abc',
  );
  const named =
    mode === 'named-current' || mode === 'named-stale-settings' || mode === 'remote-chat';
  if (named) {
    const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Placement');
    if (!saved.ok) throw Error('Expected valid placement');
    captured = saved.configuration;
    if (mode === 'named-stale-settings') {
      const settings = await store.read(modelId);
      await store.save(modelId, settings.revision, {
        ...settings,
        load: { ...settings.load, contextLength: 4096 },
      });
    }
  }
  if (mode === 'stale')
    store.cluster.writeDraft(draft.key, draft.revision, {
      modelId: draft.modelId,
      load: draft.load,
      runs: draft.runs,
    });
  let receive!: (input: unknown) => void;
  const replies: Record<string, unknown>[] = [];
  const exit = vi.fn();
  const selection = {
    deploymentId: 'desktop',
    sessionId: 'session',
    operationId: 'load',
    packageId: 'llama-cuda-development',
    modelId,
  };
  const owner = new OwnerChatChannel(
    (value) => queueMicrotask(() => receive(JSON.stringify(value))),
    () => ({
      selection,
      transport: {
        tokenCount: () => Promise.resolve(1),
        start(_identity, _messages, publish) {
          const outcome = { status: 'completed', reason: 'STOP' } as const;
          return {
            cancel() {},
            settled: (async () => {
              await publish({ type: 'text', text: 'RPC_OK' });
              await publish({ type: 'terminal', outcome });
              return outcome;
            })(),
          };
        },
      },
    }),
    () => {
      throw Error('Unexpected generation channel failure');
    },
  );
  runUtility(
    {
      receive: (handler) => {
        receive = handler;
      },
      exit,
      send: (text) => {
        const message = JSON.parse(text) as Record<string, unknown>;
        replies.push(message);
        if (message.type === 'generation') void owner.receive(message);
        if (mode === 'remote-chat' && message.type === 'broker') {
          const phases = message.action === 'launch' ? ['captured', 'ready'] : ['exited'];
          for (const phase of phases)
            queueMicrotask(() =>
              receive(
                JSON.stringify({
                  type: 'engine',
                  phase,
                  selection: message.selection,
                  code: 0,
                  ...(phase === 'ready' ? { contextLength: 7424 } : {}),
                }),
              ),
            );
        } else if (message.type === 'broker' && message.action === 'launch')
          queueMicrotask(() =>
            receive(
              JSON.stringify({
                type: 'engine',
                phase: 'failed',
                selection: message.selection,
                code: 0,
              }),
            ),
          );
      },
    },
    history,
  );
  receive(
    JSON.stringify({
      type: 'admitted',
      deploymentId: 'desktop',
      packageId: 'llama-cuda-development',
      modelId,
      chat: {
        applicationData: 'C:\\fixture',
        caller: 'window',
        provenance: {
          packageId: 'llama-cuda-development',
          upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
          configuration: {
            modelSha256: modelId,
            contextPerSlot: 7680,
            slots: 4,
            gpuLayers: 65,
            gpuDevice: gpu,
            cacheK: 'q8_0',
            cacheV: 'q8_0',
            seed: 7,
            temperature: 0.8,
          },
        },
      },
    }),
  );
  receive(
    JSON.stringify({
      type: 'command',
      text: JSON.stringify({
        id: 1,
        action: 'load',
        selection: {
          deploymentId: 'desktop',
          sessionId: 'session',
          operationId: 'load',
          packageId: 'llama-cuda-development',
          modelId,
        },
        ...(named
          ? {
              clusterConfiguration: {
                id: captured.id,
                revision: captured.revision,
                load: captured.load,
              },
            }
          : {
              modelConfiguration:
                mode === 'forged-allocation'
                  ? {
                      ...captured,
                      load: {
                        ...captured.load,
                        defaults: { ...captured.load.defaults, contextLength: 4096 },
                      },
                    }
                  : captured,
              clusterDraft: {
                key: mode === 'wrong-model' ? `model:${'b'.repeat(64)}` : draft.key,
                revision: draft.revision,
              },
            }),
      }),
    }),
  );
  await vi.waitFor(() => expect(replies.some((message) => message.type === 'reply')).toBe(true));
  expect(
    replies.filter((message) => message.type === 'broker' && message.action === 'launch'),
  ).toHaveLength(mode === 'valid' || mode === 'named-current' || mode === 'remote-chat' ? 1 : 0);
  expect(store.cluster.list()).toHaveLength(named ? 1 : 0);
  if (mode === 'remote-chat') {
    const conversation = await history.newConversation();
    receive(
      JSON.stringify({
        type: 'chat-command',
        id: 1,
        caller: 'window',
        command: { action: 'send', conversationId: conversation.id, text: 'Reply RPC_OK.' },
      }),
    );
    await vi.waitFor(() =>
      expect(
        replies.find((message) => message.type === 'chat-reply' && message.id === 1)?.reply,
      ).toMatchObject({ ok: true, conversationId: conversation.id }),
    );
    await vi.waitFor(async () =>
      expect((await history.readConversation(conversation.id)).turns[0]?.attempts[0]?.state).toBe(
        'completed',
      ),
    );
    const attempt = (await history.readConversation(conversation.id)).turns[0]!.attempts[0]!;
    expect(attempt.text).toBe('RPC_OK');
    expect(attempt.provenance.configuration.gpuDevice).toBe(gpu);
    expect(attempt.provenance.cluster?.runs).toEqual(captured.runs);
    expect(attempt.provenance.configuration.contextPerSlot).toBe(7424);
    expect(attempt.settings?.contextLength).toBe(7424);
    expect((await store.read(modelId)).load.contextLength).toBe(7401);
  }
  receive(JSON.stringify({ type: 'command', text: JSON.stringify({ id: 2, action: 'quit' }) }));
  await vi.waitFor(() =>
    expect(replies.some((message) => message.type === 'reply' && message.quit === true)).toBe(true),
  );
  expect(exit).not.toHaveBeenCalled();
  history.close();
  database.close();
});
