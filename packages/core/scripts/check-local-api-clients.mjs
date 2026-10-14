import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { readFile } from 'node:fs/promises';
import OpenAI from '../out/api-clients/javascript/node_modules/openai/index.mjs';
import { ApiServer } from '../out/local-api/server.js';
import { ApiCredentials } from '../out/local-api/credentials.js';
import { ModelConfigurationStore } from '../out/model-configuration/store.js';
import { windowsApiKeyProtection } from '../out/model-configuration/windows-protection.js';
import { capabilities, record } from '../out/model-configuration/test-fixtures.js';

// Protocol fixture only: real HTTP/DPAPI/SDKs, synthetic output, no model or external API call.
const sdk = JSON.parse(
  await readFile(
    new URL('../out/api-clients/javascript/node_modules/openai/package.json', import.meta.url),
    'utf8',
  ),
);
assert.equal(sdk.version, '7.32.0');
const database = new DatabaseSync(':memory:');
const store = new ModelConfigurationStore(
  database,
  () => {},
  () => true,
  capabilities,
  record().load,
);
const credentials = await ApiCredentials.open(store, windowsApiKeyProtection(), () =>
  server.cancelRequests(),
);
const server = new ApiServer({
  credentials,
  capabilities,
  port: 0,
  model: () => ({ id: 'model-fixture', created: 123 }),
  generate: (_caller, input, progress) => {
    const done = (async () => {
      if (input.messages.at(-1).content === 'fixture-reject') throw new Error('QUEUE_FULL');
      await progress({ type: 'reasoning', text: 'Synthetic reasoning' });
      if (input.messages.at(-1).content === 'fixture-stream-error')
        return {
          outcome: { status: 'failed', reason: 'INVALID_STREAM' },
          text: '',
          reasoning: 'Synthetic reasoning',
        };
      await progress({ type: 'text', text: 'Synthetic answer' });
      return {
        outcome: { status: 'completed', reason: 'STOP' },
        text: 'Synthetic answer',
        reasoning: 'Synthetic reasoning',
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
          completion_tokens_details: { reasoning_tokens: 1 },
        },
      };
    })();
    void done.catch(() => undefined);
    return { admitted: Promise.resolve(), done, cancel: () => {} };
  },
});
try {
  await credentials.generate();
  await server.start();
  const baseURL = server.status().address,
    apiKey = credentials.reveal();
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, logLevel: 'off' });
  const body = {
    model: 'model-fixture',
    messages: [{ role: 'user', content: 'Synthetic prompt' }],
    max_tokens: 32,
  };
  assert.equal((await client.models.list()).data[0].id, 'model-fixture');
  const completion = await client.chat.completions.create(body);
  assert.equal(completion.choices[0].message.content, 'Synthetic answer');
  assert.equal(completion.choices[0].message.reasoning_content, 'Synthetic reasoning');
  assert.equal(completion.usage.total_tokens, 5);
  const stream = await client.chat.completions.create({
    ...body,
    stream: true,
    stream_options: { include_usage: true },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, 1);
  assert.equal(chunks.at(-1).usage.total_tokens, 5);
  assert.equal(chunks.at(-2).choices[0].finish_reason, 'stop');
  await assert.rejects(
    client.chat.completions.create({ ...body, id_slot: 0 }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    client.chat.completions.create({
      ...body,
      messages: [{ role: 'user', content: 'fixture-reject' }],
    }),
    (error) => error.status === 429,
  );
  await assert.rejects(
    (async () => {
      const failed = await client.chat.completions.create({
        ...body,
        stream: true,
        messages: [{ role: 'user', content: 'fixture-stream-error' }],
      });
      for await (const chunk of failed) assert.equal(chunk.object, 'chat.completion.chunk');
    })(),
  );
  console.log(
    'JavaScript openai 7.32.0: listing, JSON, SSE/usage, validation, queue and stream errors passed',
  );
  const python = `import sys,json,openai
from openai import OpenAI,APIStatusError
assert openai.__version__=='3.29.0'
settings=json.load(sys.stdin)
with OpenAI(base_url=settings['baseURL'],api_key=settings['apiKey'],max_retries=0) as client:
    assert client.models.list().data[0].id=='model-fixture'
    body=dict(model='model-fixture',messages=[dict(role='user',content='Synthetic prompt')],max_tokens=32)
    response=client.chat.completions.create(**body)
    assert response.choices[0].message.content=='Synthetic answer'
    assert response.choices[0].message.reasoning_content=='Synthetic reasoning'
    assert response.usage.total_tokens==5
    with client.chat.completions.create(**body,stream=True,stream_options=dict(include_usage=True)) as stream:
        chunks=list(stream)
    assert len(set(chunk.id for chunk in chunks))==1
    assert chunks[-1].usage.total_tokens==5
    assert chunks[-2].choices[0].finish_reason=='stop'
    try:
        client.chat.completions.create(**body,extra_body=dict(id_slot=0))
        raise AssertionError('Unsupported field was accepted')
    except APIStatusError as error:
        assert error.status_code==400
print('Python openai 3.29.0: listing, JSON, SSE/usage and validation passed')
`;
  await new Promise((resolve, reject) => {
    const child = spawn(
      fileURLToPath(new URL('../out/api-clients/python/Scripts/python.exe', import.meta.url)),
      ['-c', python],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Python fixture timed out'));
    }, 30000);
    let output = '',
      errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk.toString();
      if (errors.length > 16384) child.kill();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        process.stdout.write(output);
        resolve();
      } else reject(new Error(`Python fixture failed: ${errors.slice(0, 16384)}`));
    });
    child.stdin.end(JSON.stringify({ baseURL, apiKey }));
  });
} finally {
  await server.stop();
  credentials.close();
  database.close();
}
