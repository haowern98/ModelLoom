import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { measureChatRequest } from './rpc-prefill-evidence.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function fixtureServer(t, handler) {
  let serverFailure;
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      serverFailure = error;
      response.destroy();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/fixture-url-secret`,
    serverFailure: () => serverFailure,
  };
}

async function writeFragments(response, chunks) {
  for (const chunk of chunks) {
    response.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  response.end();
}

async function assertGenericFailure(url, options = {}) {
  await assert.rejects(
    measureChatRequest(url, { messages: [{ role: 'user', content: 'private-prompt' }] }, options),
    (error) => {
      assert.equal(error.message, 'Chat request failed.');
      assert.equal(error.message.includes('private-prompt'), false);
      assert.equal(error.message.includes('private-error-body'), false);
      assert.equal(error.message.includes('private-auth-token'), false);
      return true;
    },
  );
}

test('measures a fragmented SSE chat request without returning content or secrets', async (t) => {
  let requestMethod;
  let requestAuthorization;
  let requestBody = '';
  const fixture = await fixtureServer(t, async (request, response) => {
    requestMethod = request.method;
    requestAuthorization = request.headers.authorization;
    for await (const chunk of request) requestBody += chunk.toString('utf8');

    const events = [
      'data: {"choices":[{"delta":{"content":"","reasoning_content":"考"},"finish_reason":null}],"timings":{"prompt_n":3,"prompt_ms":20,"prompt_per_second":1.5,"cache_n":5,"ignored_metric":"private-metric"}}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"hello🌍"},"finish_reason":null}],"timings":{"prompt_n":4,"prompt_ms":-1,"predicted_n":2,"predicted_ms":50,"predicted_per_second":3.25,"cache_n":null},"usage":{"prompt_tokens":3,"private_usage":"private-usage"}}\r\n\r\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"timings":{"prompt_n":7},"usage":{"completion_tokens":2,"total_tokens":5}}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ].map((event) => Buffer.from(event));
    const firstEvent = events[0];
    const token = Buffer.from('考');
    const tokenOffset = firstEvent.indexOf(token);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    await writeFragments(response, [
      firstEvent.subarray(0, tokenOffset + 1),
      firstEvent.subarray(tokenOffset + 1, tokenOffset + 2),
      firstEvent.subarray(tokenOffset + 2),
      ...events.slice(1),
    ]);
  });

  const body = { messages: [{ role: 'user', content: 'private-prompt' }] };
  const clock = [100, 110, 120, 130];
  const report = await measureChatRequest(fixture.url, body, {
    headers: { authorization: 'Bearer private-auth-token' },
    now: () => clock.shift(),
  });

  assert.equal(fixture.serverFailure(), undefined);
  assert.equal(requestMethod, 'POST');
  assert.equal(requestAuthorization, 'Bearer private-auth-token');
  assert.equal(requestBody, JSON.stringify(body));
  assert.equal(report.wallMs, 30);
  assert.equal(report.headersMs, 10);
  assert.equal(report.firstTokenMs, 20);
  assert.equal(report.contentSha256, sha256('hello🌍'));
  assert.equal(report.reasoningSha256, sha256('考'));
  assert.equal(report.contentCharacters, 6);
  assert.equal(report.reasoningCharacters, 1);
  assert.deepEqual(report.timings, {
    prompt_n: 7,
    prompt_ms: 20,
    prompt_per_second: 1.5,
    predicted_n: 2,
    predicted_ms: 50,
    predicted_per_second: 3.25,
    cache_n: 5,
  });
  assert.deepEqual(report.usage, {
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
  });
  assert.equal(report.requestSha256, sha256(JSON.stringify(body)));

  const serialized = JSON.stringify(report);
  for (const secret of [
    'private-prompt',
    'private-auth-token',
    'hello🌍',
    '考',
    'fixture-url-secret',
    'private-metric',
    'private-usage',
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('reports empty output when a valid response finishes without generated text', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      [
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ].join(''),
    );
  });

  const clock = [0, 10, 20];
  const report = await measureChatRequest(fixture.url, {}, { now: () => clock.shift() });

  assert.equal(report.wallMs, 20);
  assert.equal(report.headersMs, 10);
  assert.equal(report.firstTokenMs, null);
  assert.equal(report.contentSha256, sha256(''));
  assert.equal(report.reasoningSha256, sha256(''));
  assert.equal(report.contentCharacters, 0);
  assert.equal(report.reasoningCharacters, 0);
  assert.deepEqual(report.usage, { prompt_tokens: 4 });
});

test('rejects malformed SSE JSON with a generic error', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {malformed private-error-body}\n\n');
  });

  await assertGenericFailure(fixture.url);
});

test('rejects a response that ends before the SSE done marker', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}]}\n\n');
  });

  await assertGenericFailure(fixture.url);
});

test('rejects a stream that errors before the SSE done marker', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n');
    response.destroy();
  });

  await assertGenericFailure(fixture.url);
});

test('rejects a done marker without a valid final response', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: [DONE]\n\n');
  });

  await assertGenericFailure(fixture.url);
});

for (const [name, events] of [
  [
    'explicit stream errors',
    [
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { error: { message: 'private-error-body' } },
    ],
  ],
  [
    'content after completion',
    [
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [{ delta: { content: 'late' }, finish_reason: null }] },
    ],
  ],
  ['unknown terminal reasons', [{ choices: [{ delta: {}, finish_reason: 'failed' }] }]],
]) {
  test(`rejects ${name} instead of recording a successful measurement`, async (t) => {
    const fixture = await fixtureServer(t, (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
      );
    });
    await assertGenericFailure(fixture.url);
  });
}

test('rejects a final response that arrives after the done marker', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      ['data: [DONE]\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'].join(''),
    );
  });

  await assertGenericFailure(fixture.url);
});

test('rejects noncomment SSE events after the done marker', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      [
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      ].join(''),
    );
  });

  await assertGenericFailure(fixture.url);
});

test('rejects a truncated UTF-8 tail after the done marker', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      Buffer.concat([
        Buffer.from(
          ['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'].join(
            '',
          ),
        ),
        Buffer.from([0xe2, 0x82]),
      ]),
    );
  });

  await assertGenericFailure(fixture.url);
});

test('rejects an SSE event larger than one mebibyte', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${'x'.repeat(1024 * 1024)}\n\n`);
  });

  await assertGenericFailure(fixture.url);
});

test('rejects HTTP errors without exposing their response body', async (t) => {
  const fixture = await fixtureServer(t, (_request, response) => {
    response.writeHead(401, { 'content-type': 'text/plain' });
    response.end('private-error-body');
  });

  await assertGenericFailure(fixture.url, {
    headers: { authorization: 'Bearer private-auth-token' },
  });
});

test('cancels an HTTP error body without reading or exposing it', async (t) => {
  let responseClosedResolve;
  const responseClosed = new Promise((resolve) => {
    responseClosedResolve = resolve;
  });
  const fixture = await fixtureServer(t, (_request, response) => {
    response.on('close', responseClosedResolve);
    response.writeHead(401, { 'content-type': 'text/plain' });
    response.flushHeaders();
    response.write('private-error-body');
    setTimeout(() => response.end(), 300);
  });

  await assertGenericFailure(fixture.url, {
    headers: { authorization: 'Bearer private-auth-token' },
  });
  const closedPromptly = await Promise.race([
    responseClosed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  assert.equal(closedPromptly, true);
});
