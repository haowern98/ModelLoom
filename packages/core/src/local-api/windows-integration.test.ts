import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { openModelConfigurationStore } from '../model-configuration/store.js';
import { trustedHistoryRoot } from '../history/windows-directory.js';
import { windowsApiKeyProtection } from '../model-configuration/windows-protection.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { ConfigurationController } from '../model-configuration/controller.js';
import { HistoryStore } from '../history/store.js';
import { ChatController } from '../generation/chat-controller.js';
import { ApiController } from './controller.js';
import type { ResolvedRequestSettings } from '../model-configuration/contracts.js';
it('serves through protected configuration and the shared core, then recovers a key without autostart', async () => {
  const base = fileURLToPath(new URL('../../out/api-native-fixtures/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'case-'));
  if (!path.resolve(root).startsWith(path.resolve(base) + path.sep))
    throw new Error('Invalid fixture root');
  const open = () =>
    openModelConfigurationStore(
      trustedHistoryRoot(root),
      (id) => id === record().modelId,
      capabilities,
      record().load,
    );
  let owner = open();
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  const chat = new ChatController(history, 'window', () => {});
  const active = {
    modelId: record().modelId,
    revision: 0,
    profileId: capabilities.profileId,
    load: record().load,
  };
  const configuration = new ConfigurationController(
    owner.store,
    'window',
    capabilities,
    record().load,
    () => active,
  );
  let ready = false;
  let api = new ApiController(
    owner.store,
    'window',
    active.modelId,
    capabilities,
    windowsApiKeyProtection,
    () => ready,
    () => chat,
    0,
  );
  const captured: ResolvedRequestSettings[] = [];
  try {
    expect(
      await api.command('window', {
        action: 'registerImport',
        modelId: active.modelId,
        created: 123,
      }),
    ).toEqual({ ok: true, registered: true });
    const initial = await owner.store.read(active.modelId);
    await owner.store.save(active.modelId, 0, {
      ...initial,
      generation: {
        ...initial.generation,
        temperature: 0.7,
        systemPrompt: 'Synthetic instruction',
      },
    });
    await chat.bind({
      session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
      provenance: {
        packageId: 'fixture',
        upstreamCommit: 'a'.repeat(40),
        configuration: {
          modelSha256: active.modelId,
          slots: 4,
          contextPerSlot: 7680,
          gpuLayers: 0,
          cacheK: 'f16',
          cacheV: 'f16',
          seed: 7,
          temperature: 0.8,
        },
      },
      configuration: {
        capabilities,
        capture: (overrides) => configuration.resolve(active, overrides),
      },
      cleanup: () => Promise.resolve(),
      transport: {
        tokenCount: (messages, _signal, settings) => {
          expect(messages[0]).toEqual({ role: 'system', content: 'Synthetic instruction' });
          expect(settings).toBeDefined();
          return Promise.resolve(10);
        },
        start: (_identity, _messages, progress, settings) => {
          if (!settings) throw new Error('Missing settings');
          captured.push(settings);
          const settled = (async () => {
            await progress({ type: 'text', text: 'Synthetic answer' });
            await progress({
              type: 'terminal',
              outcome: { status: 'completed', reason: 'STOP' },
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            });
            return { status: 'completed', reason: 'STOP' } as const;
          })();
          return { settled, cancel: () => {} };
        },
      },
    });
    expect((await api.command('window', { action: 'generateKey' })).ok).toBe(true);
    const revealed = await api.command('window', { action: 'revealKey' });
    if (!revealed.ok || !('secret' in revealed) || !revealed.secret)
      throw new Error('Missing fixture key');
    const key = revealed.secret;
    const started = await api.command('window', { action: 'start' });
    if (!started.ok || !('status' in started) || !started.status.address)
      throw new Error('Missing fixture listener');
    ready = true;
    const response = await fetch(`${started.status.address}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `model-${active.modelId}`,
        messages: [{ role: 'user', content: 'Synthetic API prompt' }],
        temperature: 0.2,
        max_tokens: 32,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: 'Synthetic answer' } }],
      usage: { total_tokens: 12 },
    });
    expect(captured[0]!.parameters.temperature).toBe(0.2);
    expect(await history.listConversations()).toEqual([]);
    expect((await api.command('window', { action: 'stop' })).ok).toBe(true);
    const conversation = await history.newConversation();
    expect(
      (
        await chat.command('window', {
          action: 'send',
          conversationId: conversation.id,
          text: 'Synthetic Chat prompt',
        })
      ).ok,
    ).toBe(true);
    await expect
      .poll(
        async () => (await history.readConversation(conversation.id)).turns[0]?.attempts[0]?.state,
      )
      .toBe('completed');
    expect(captured[1]!.parameters.temperature).toBe(0.7);
    await api.close();
    await chat.close();
    await configuration.close();
    owner.close();
    owner = open();
    api = new ApiController(
      owner.store,
      'window',
      active.modelId,
      capabilities,
      windowsApiKeyProtection,
      () => false,
      () => undefined,
      0,
    );
    const recovered = await api.command('window', { action: 'revealKey' });
    expect(recovered).toMatchObject({
      ok: true,
      secret: key,
      status: { phase: 'stopped', address: null, keyPresent: true },
    });
    expect(await owner.store.readImport(active.modelId)).toBe(123);
  } finally {
    await api.close();
    await chat.close();
    await configuration.close();
    history.close();
    owner.close();
    rmSync(root, { recursive: true, force: true });
  }
});
