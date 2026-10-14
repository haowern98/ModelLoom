import { afterEach, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { ApiServer } from './server.js';
import { ApiCredentials } from './credentials.js';
import type {
  ApiGenerationHandle,
  ApiGenerationResult,
  ApiGenerationInput,
} from '../generation/api-execution.js';
import { capabilities } from '../model-configuration/test-fixtures.js';
import type { GenerationChunk } from '../generation/contracts.js';
import type { ProtectedApiCredential } from '../model-configuration/store.js';
const owners: { server: ApiServer; credentials: ApiCredentials }[] = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    await owner.server.stop();
    owner.credentials.close();
  }
});
async function fixture(port = 0) {
  let saved: ProtectedApiCredential | null = null,
    opaque: Buffer | undefined,
    ready = false;
  const credentials = await ApiCredentials.open(
    {
      readCredential: () => Promise.resolve(saved),
      replaceCredential: (generation, protectedKey) => {
        saved = { generation: generation + 1, protectedKey };
        return Promise.resolve(saved);
      },
    },
    {
      protect: (key) => {
        opaque = Buffer.from(key);
        return Buffer.from('synthetic protected bytes');
      },
      unprotect: () => Buffer.from(opaque!),
    },
    () => server?.cancelRequests() ?? Promise.resolve(),
  );
  const calls: ApiGenerationInput[] = [];
  let implementation = (
    input: ApiGenerationInput,
    progress: (chunk: GenerationChunk) => void | Promise<void>,
  ): ApiGenerationHandle => {
    calls.push(input);
    const done = (async () => {
      await progress({ type: 'reasoning', text: 'Thinking' });
      return {
        text: '',
        reasoning: 'Thinking',
        outcome: { status: 'limit-reached', reason: 'OUTPUT_LIMIT' },
        usage: {
          prompt_tokens: 10,
          completion_tokens: 32,
          total_tokens: 42,
          completion_tokens_details: { reasoning_tokens: 32 },
        },
      } as const;
    })();
    return { admitted: Promise.resolve(), done, cancel: () => {} };
  };
  const server = new ApiServer({
    credentials,
    capabilities,
    port,
    model: () => (ready ? { id: 'model-fixture', created: 123 } : null),
    generate: (_caller, input, progress) => implementation(input, progress),
  });
  owners.push({ server, credentials });
  return {
    server,
    credentials,
    calls,
    setReady: () => {
      ready = true;
    },
    implement: (next: typeof implementation) => {
      implementation = next;
    },
    start: async () => {
      await credentials.generate();
      await server.start();
      return { key: credentials.reveal(), url: server.status().address! };
    },
  };
}
it('starts only explicitly with a key, authenticates listing and denies browser/rebinding requests', async () => {
  const f = await fixture();
  expect(f.server.status().phase).toBe('stopped');
  await expect(f.server.start()).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
  const { key, url } = await f.start();
  expect((await fetch(`${url}/models`)).status).toBe(401);
  expect(
    (await fetch(`${url}/models`, { headers: { Origin: 'null', Authorization: `Bearer ${key}` } }))
      .status,
  ).toBe(403);
  const craftedHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      `${url}/models`,
      { headers: { Host: '127.0.0.1.evil:8000', Authorization: `Bearer ${key}` } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(craftedHost).toBe(403);
  expect(
    await (await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${key}` } })).json(),
  ).toEqual({ object: 'list', data: [] });
  f.setReady();
  expect(
    await (await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${key}` } })).json(),
  ).toEqual({
    object: 'list',
    data: [{ id: 'model-fixture', created: 123, object: 'model', owned_by: 'modelloom' }],
  });
  await f.server.stop();
  expect(f.server.status().address).toBeNull();
  expect(f.credentials.status().present).toBe(true);
});
it('rejects ambiguous authorization and oversized headers before disclosing models', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  f.setReady();
  const port = Number(new URL(url).port);
  const raw = (headers: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port }, () =>
        socket.end(
          `GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headers}\r\nConnection: close\r\n\r\n`,
        ),
      );
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Fixture timed out'));
      }, 3000);
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk.toString();
      });
      socket.on('error', reject);
      socket.on('close', () => {
        clearTimeout(timer);
        resolve(text);
      });
    });
  const duplicate = await raw(`Authorization: Bearer ${key}\r\nAuthorization: Bearer ${key}`);
  expect(duplicate).toMatch(/^HTTP\/1\.1 (?:400|401)/u);
  expect(duplicate).not.toContain('model-fixture');
  const oversized = await raw(`X-Oversized: ${'x'.repeat(16385)}`);
  expect(oversized).toMatch(/^HTTP\/1\.1 431/u);
  expect(f.calls).toHaveLength(0);
});
it('serializes repeated Start and Stop and bounds open connections', async () => {
  const f = await fixture();
  await f.credentials.generate();
  await Promise.all([f.server.start(), f.server.start(), f.server.stop(), f.server.start()]);
  expect(f.server.status().phase).toBe('running');
  const port = Number(new URL(f.server.status().address!).port);
  const sockets = [];
  try {
    for (let index = 0; index < 32; index++) {
      const socket = connect({ host: '127.0.0.1', port });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
    }
    const extra = connect({ host: '127.0.0.1', port });
    sockets.push(extra);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection bound was not enforced')), 2000);
      extra.once('error', () => {});
      extra.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(f.server.status().requests).toBe(0);
    expect(f.server.status().phase).toBe('running');
  } finally {
    for (const socket of sockets) socket.destroy();
  }
});
it('reports a port conflict without falling back or disturbing the existing listener', async () => {
  const first = await fixture(),
    { url } = await first.start();
  const second = await fixture(Number(new URL(url).port));
  await second.credentials.generate();
  await expect(second.server.start()).rejects.toThrow('ADDRESS_UNAVAILABLE');
  expect(second.server.status()).toMatchObject({
    phase: 'failed',
    address: null,
    error: 'ADDRESS_UNAVAILABLE',
  });
  expect(first.server.status().phase).toBe('running');
});
it('preserves thinking-only length, actual usage, and stable public JSON/SSE identities', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  f.setReady();
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const body = {
    model: 'model-fixture',
    messages: [{ role: 'user', content: 'Question' }],
    temperature: 0,
    seed: 0,
    max_tokens: 32,
  };
  const response = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as Record<string, unknown>;
  expect(result).toMatchObject({
    model: 'model-fixture',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '', reasoning_content: 'Thinking' },
        finish_reason: 'length',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 32, total_tokens: 42 },
  });
  const streamed = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
  });
  const text = await streamed.text();
  expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
  const chunks = text
    .trim()
    .split('\n\n')
    .slice(0, -1)
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
  expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { completion_tokens: 32 } });
  expect(chunks.at(-2)).toMatchObject({
    choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
  });
  expect(f.calls[0]!.overrides).toEqual({ temperature: 0, seed: 0, max_tokens: 32 });
  expect(f.server.status().requests).toBe(2);
  expect(f.server.status().responseTimeMs).not.toBeNull();
});
it('bounds encoded SSE records while preserving Unicode and escaped text', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  f.setReady();
  const answer = `${'x'.repeat(4095)}😀\n\u0001`.repeat(30);
  f.implement((_input, progress) => ({
    admitted: Promise.resolve(),
    done: (async () => {
      await progress({ type: 'text', text: answer });
      return {
        text: answer,
        reasoning: '',
        outcome: { status: 'completed', reason: 'STOP' },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as const;
    })(),
    cancel: () => {},
  }));
  const response = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'model-fixture',
      messages: [{ role: 'user', content: 'Synthetic' }],
      stream: true,
    }),
  });
  const records = (await response.text()).trim().split('\n\n');
  for (const record of records)
    expect(Buffer.byteLength(`${record}\n\n`)).toBeLessThanOrEqual(65536);
  expect(records.at(-1)).toBe('data: [DONE]');
  const content = records.slice(0, -1).map((record) => {
    const parsed = JSON.parse(record.slice(6)) as {
      choices: { delta: { content?: string } }[];
    };
    return parsed.choices[0]?.delta.content ?? '';
  });
  expect(content.join('')).toBe(answer);
  for (const value of content)
    expect(value).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
});
it('rejects malformed, ambiguous and unsupported requests before generation without exposing a model', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const valid = { model: 'model-fixture', messages: [{ role: 'user', content: 'Hello' }] };
  for (const body of [
    '{"model":"a","model":"b"}',
    JSON.stringify({ ...valid, id_slot: 0 }),
    JSON.stringify({ ...valid, max_tokens: 513 }),
  ])
    expect((await fetch(`${url}/chat/completions`, { method: 'POST', headers, body })).status).toBe(
      400,
    );
  expect(
    (
      await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
        body: 'x',
      })
    ).status,
  ).toBe(415);
  expect(
    (await fetch(`${url}/chat/completions`, { method: 'POST', headers, body: ' '.repeat(262145) }))
      .status,
  ).toBe(413);
  const unloaded = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(valid),
  });
  expect(unloaded.status).toBe(400);
  expect(await unloaded.json()).toMatchObject({
    error: { type: 'invalid_request_error', param: 'model', code: null },
  });
  expect(f.calls).toHaveLength(0);
  expect(f.server.status().logs.join(' ')).not.toContain(key);
});
it('matches the observed malformed JSON and unsupported media error categories', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  const malformed = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({
    error: { type: 'invalid_request', code: 'invalid_json' },
  });
  const media = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
    body: '{}',
  });
  expect(media.status).toBe(415);
  expect(await media.json()).toMatchObject({
    error: { type: 'invalid_request_error', code: 'unsupported_media_type' },
  });
  expect(f.calls).toHaveLength(0);
});
it('delivers the oversized-body error reliably while closing the rejected request', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  for (let index = 0; index < 20; index++) {
    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: ' '.repeat(262145),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'request_too_large' } });
    expect(response.headers.get('connection')).toBe('close');
  }
  expect(f.calls).toHaveLength(0);
});
it('Stop cancels its requests but waits for settlement', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  f.setReady();
  let finish!: (result: ApiGenerationResult) => void,
    cancelled = 0;
  f.implement(() => ({
    admitted: Promise.resolve(),
    done: new Promise((resolve) => {
      finish = resolve;
    }),
    cancel: () => {
      cancelled++;
    },
  }));
  const request = fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'model-fixture',
      messages: [{ role: 'user', content: 'Synthetic' }],
    }),
  }).catch(() => undefined);
  for (let i = 0; i < 20 && !finish; i++)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  let stopped = false;
  const stopping = f.server.stop().then(() => {
    stopped = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  try {
    expect(cancelled).toBe(1);
    expect(stopped).toBe(false);
  } finally {
    finish({ outcome: { status: 'cancelled', reason: 'USER_CANCELLED' }, text: '', reasoning: '' });
    await stopping;
    await request;
  }
  expect(stopped).toBe(true);
});
it('rotation waits for cancelled native settlement before admitting the new key', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  f.setReady();
  let finish!: (result: ApiGenerationResult) => void,
    cancelled = 0;
  f.implement(() => ({
    admitted: Promise.resolve(),
    done: new Promise((resolve) => {
      finish = resolve;
    }),
    cancel: () => {
      cancelled++;
    },
  }));
  const request = fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'model-fixture',
      messages: [{ role: 'user', content: 'Synthetic' }],
    }),
  }).catch(() => undefined);
  await expect.poll(() => typeof finish).toBe('function');
  let rotated = false;
  const rotation = f.credentials.generate().then(() => {
    rotated = true;
  });
  try {
    await expect.poll(() => cancelled).toBe(1);
    expect(rotated).toBe(false);
    expect(f.credentials.authenticate(key)).toBeNull();
    expect(f.credentials.canServe()).toBe(false);
  } finally {
    finish({ outcome: { status: 'cancelled', reason: 'USER_CANCELLED' }, text: '', reasoning: '' });
    await rotation;
    await request;
  }
  expect(f.credentials.authenticate(f.credentials.reveal())).not.toBeNull();
  expect(f.server.status().phase).toBe('running');
});
it('revokes the old key and callers on rotation without stopping the listener', async () => {
  const f = await fixture(),
    { key, url } = await f.start();
  f.setReady();
  const caller = f.credentials.authenticate(key);
  if (!caller) throw new Error('Missing test caller');
  await f.credentials.generate();
  expect(f.server.status().phase).toBe('running');
  expect(
    (await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${key}` } })).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${f.credentials.reveal()}` },
      })
    ).status,
  ).toBe(200);
});
