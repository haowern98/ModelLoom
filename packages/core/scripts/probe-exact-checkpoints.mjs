// Fixed two-PC benchmark inputs. Mining and the remote worker are owned by the
// outer bounded test lease; this process owns only its exact coordinator children.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { measureChatRequest } from './rpc-prefill-evidence.mjs';

const core = fileURLToPath(new URL('../', import.meta.url));
const root = path.join(core, 'out/exact-checkpoints');
const deviceOnly = process.argv.length === 3 && process.argv[2] === '--device-only';
if (process.argv.length !== 2 && !deviceOnly)
  throw Error('Use no arguments or --device-only with a completed reference');
const stage = path.join(root, deviceOnly ? 'comparison-final' : 'comparison');
await mkdir(stage); // Preserve earlier evidence, never overwrite an earlier run.
const args = JSON.parse(
  await readFile(
    path.join(core, 'out/stock-bonsai-tailscale-20261127/coordinator-args.json'),
    'utf8',
  ),
);
args[args.indexOf('--port') + 1] = '18080';
const url = 'http://127.0.0.1:18080';
const requestParameters = {
  stream: true,
  timings_per_token: true,
  return_progress: true,
  stream_options: { include_usage: true },
  n: 1,
  max_tokens: -1,
  temperature: 0.8,
  top_k: 40,
  top_p: 0.95,
  min_p: 0.05,
  repeat_penalty: 1,
  presence_penalty: 0,
  seed: 7,
  stop: [],
};
const env = {
  ...process.env,
  CUDA_VISIBLE_DEVICES: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
  CUDA_CACHE_MAXSIZE: '268435456',
  GGML_RPC_NO_RDMA: '1',
};
delete env.CUDA_CACHE_DISABLE;
delete env.CUDA_CACHE_PATH;
let active;
async function stop() {
  if (!active || active.exitCode !== null || active.signalCode !== null) {
    active = undefined;
    return;
  }
  const ended = once(active, 'exit');
  active.kill(); // Retained ChildProcess, never lookup/kill by executable name.
  await Promise.race([
    ended,
    delay(10000).then(() => {
      throw Error('Owned coordinator exit deadline');
    }),
  ]);
  active = undefined;
}
async function start(name, runtime) {
  active = spawn(path.join(runtime, 'llama-server.exe'), args, {
    cwd: runtime,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  active.stdout.pipe(createWriteStream(path.join(stage, `${name}.stdout.log`), { flags: 'wx' }));
  active.stderr.pipe(createWriteStream(path.join(stage, `${name}.stderr.log`), { flags: 'wx' }));
  await once(active, 'spawn');
  await writeFile(
    path.join(stage, `${name}-owned.json`),
    JSON.stringify({
      pid: active.pid,
      image: path.join(runtime, 'llama-server.exe'),
      at: new Date().toISOString(),
    }),
  );
  const limit = Date.now() + 240000;
  while (Date.now() < limit) {
    if (active.exitCode !== null) throw Error(`Coordinator ${name} exited: ${active.exitCode}`);
    try {
      if (
        (await globalThis.fetch(`${url}/health`, { signal: globalThis.AbortSignal.timeout(2000) }))
          .ok
      )
        return;
    } catch {
      /* Still loading; bounded by limit. */
    }
    await delay(500);
  }
  throw Error(`Coordinator ${name} readiness deadline`);
}
async function request(messages, slot) {
  let answer = '',
    reasoning = '',
    parsed;
  const fetch = async (...input) => {
    const response = await globalThis.fetch(...input);
    const [consume, observe] = response.body.tee();
    parsed = (async () => {
      const decoder = new globalThis.TextDecoder();
      let pending = '';
      for await (const chunk of observe) {
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).trimEnd();
          pending = pending.slice(newline + 1);
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;
          answer += delta?.content ?? '';
          reasoning += delta?.reasoning_content ?? '';
          if (answer.length + reasoning.length + pending.length > 16777216)
            throw Error('Diagnostic response limit');
        }
      }
    })();
    parsed.catch(() => undefined);
    return new globalThis.Response(consume, { status: response.status, headers: response.headers });
  };
  const result = await measureChatRequest(
    `${url}/v1/chat/completions`,
    { model: 'Bonsai-27B', messages, ...requestParameters, id_slot: slot },
    { fetch, signal: globalThis.AbortSignal.timeout(180000) },
  );
  await parsed;
  return { result, answer, reasoning };
}
const reports = {};
if (deviceOnly) {
  reports.reference = JSON.parse(
    await readFile(path.join(root, 'comparison/reference.json'), 'utf8'),
  );
  if (Object.keys(reports.reference).sort().join(',') !== 'cross-slot,followup,fresh,repeat')
    throw Error('Reference scenarios incomplete');
  await writeFile(path.join(stage, 'reference.json'), JSON.stringify(reports.reference, null, 2), {
    flag: 'wx',
  });
}
try {
  for (const [name, runtime] of [
    ['reference', path.join(core, 'out/activation/b11306/candidate')],
    ['device', path.join(root, 'candidate')],
  ]) {
    if (deviceOnly && name === 'reference') continue;
    await start(name, runtime);
    const user = {
      role: 'user',
      content: 'what is the name of the place where chinese emperors live in',
    };
    const first = await request([user], 0);
    const followup = [
      user,
      { role: 'assistant', content: first.answer, reasoning_content: first.reasoning },
      { role: 'user', content: 'Which city is that in?' },
    ];
    reports[name] = { fresh: first.result };
    await writeFile(path.join(stage, `${name}.json`), JSON.stringify(reports[name], null, 2), {
      flag: 'wx',
    });
    console.log(JSON.stringify({ runtime: name, scenario: 'fresh', ...first.result }));
    for (const [scenario, messages, slot] of [
      ['repeat', [user], 0],
      ['followup', followup, 0],
      ['cross-slot', followup, 1],
    ]) {
      const { result } = await request(messages, slot);
      reports[name][scenario] = result;
      await writeFile(path.join(stage, `${name}.json`), JSON.stringify(reports[name], null, 2));
      console.log(JSON.stringify({ runtime: name, scenario, ...result }));
    }
    await stop();
  }
  const comparison = Object.keys(reports.reference).map((scenario) => {
    const a = reports.reference[scenario],
      b = reports.device[scenario];
    return {
      scenario,
      sameRequest: a.requestSha256 === b.requestSha256,
      sameAnswer: a.contentSha256 === b.contentSha256,
      sameReasoning: a.reasoningSha256 === b.reasoningSha256,
      reference: a.timings,
      device: b.timings,
      prefillSpeedup: a.timings.prompt_ms / b.timings.prompt_ms,
    };
  });
  await writeFile(path.join(stage, 'comparison.json'), JSON.stringify(comparison, null, 2));
  if (comparison.some((row) => !row.sameRequest || !row.sameAnswer || !row.sameReasoning))
    throw Error('Output/request equivalence failed');
  console.log('PASS full-output equivalence for all matched scenarios');
} finally {
  await stop();
}
