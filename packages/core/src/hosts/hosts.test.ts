import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Snapshot } from '../runtime/contracts.js';

interface Reply {
  id: number;
  snapshot?: Snapshot;
  error?: string;
  pids?: number[];
  corePid?: number;
}
const children: ReturnType<typeof spawn>[] = [];
const ownedPids = new Set<number>();
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function host(kind: 'headless' | 'desktop', mode = 'ready') {
  const root = fileURLToPath(new URL('../../out/', import.meta.url));
  const executable =
    kind === 'headless'
      ? process.execPath
      : String(
          createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url))(
            'electron',
          ),
        );
  const entry =
    kind === 'headless'
      ? root + 'hosts/headless.js'
      : fileURLToPath(new URL('../../tests/desktop-entry.cjs', import.meta.url));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [entry, mode], {
    windowsHide: true,
    stdio: kind === 'desktop' ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'],
    env,
  });
  const { stdin, stdout, stderr } = child;
  if (!stdin || !stdout || !stderr) throw new Error('Missing owned harness pipes');
  const harnessInput = stdin;
  children.push(child);
  const replies = new Map<number, (value: Reply) => void>();
  let text = '';
  let errors = '';
  child.on('exit', (code, signal) => {
    errors += ` host exit ${String(code)} ${String(signal)}`;
  });
  let id = 0;
  stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const receive = (reply: Reply) => {
    for (const pid of reply.pids ?? []) ownedPids.add(pid);
    if (reply.corePid) ownedPids.add(reply.corePid);
    replies.get(reply.id)?.(reply);
  };
  child.on('message', (reply: Reply) => receive(reply));
  stdout.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    let end: number;
    while ((end = text.indexOf('\n')) !== -1) {
      const line = text.slice(0, end);
      text = text.slice(end + 1);
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'number')
          throw new Error('Invalid harness reply');
        // Test harness replies originate in the fixture host; production IPC is separately gated.
        receive(value as Reply);
      } catch {
        errors += line;
      }
    }
  });
  async function send(action: string, data = {}): Promise<Reply> {
    const requestId = ++id;
    return await new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Host did not reply: ${errors}`)), 8_000);
      replies.set(requestId, (reply) => {
        clearTimeout(timer);
        replies.delete(requestId);
        resolve(reply);
      });
      const command = JSON.stringify({ id: requestId, action, ...data });
      if (kind === 'desktop') child.send(command);
      else harnessInput.write(command + '\n');
    });
  }
  function raw(text: string) {
    if (kind === 'desktop') child.send(text);
    else harnessInput.write(text + '\n');
  }
  return {
    child,
    send,
    raw,
    errors: () => errors,
    exit: () =>
      new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) resolve(child.exitCode);
        else child.once('exit', resolve);
      }),
  };
}
const selection = (operationId = 'op1') => ({
  deploymentId: 'fixture-host',
  sessionId: 's1',
  operationId,
  packageId: 'fixture',
  modelId: 'fixture',
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  }
  await expect.poll(() => [...ownedPids].filter(running), { timeout: 3_000 }).toEqual([]);
  ownedPids.clear();
});
it.each(['headless', 'desktop'] as const)(
  '%s shares lifecycle and gracefully quits with no owned engines',
  async (kind) => {
    const running = host(kind);
    const started = await running.send('load', { selection: selection() });
    expect(started.snapshot?.phase).toBe('ready');
    expect(started.pids).toHaveLength(1);
    if (kind === 'desktop') expect(started.corePid).toBeGreaterThan(0);
    const identity = {
      deploymentId: 'fixture-host',
      sessionId: 's1',
      operationId: 'op1',
      requestId: 'r1',
    };
    await running.send('record', { event: { type: 'request-started', ...identity } });
    await running.send('record', { event: { type: 'text', ...identity, text: 'partial' } });
    await running.send('crash');
    await expect
      .poll(async () => (await running.send('snapshot')).snapshot?.phase, { timeout: 4_000 })
      .toBe('failed');
    expect((await running.send('snapshot')).snapshot?.requests.r1).toMatchObject({
      text: 'partial',
      status: 'interrupted',
    });
    expect((await running.send('load', { selection: selection('op2') })).snapshot?.phase).toBe(
      'ready',
    );
    const stopped = await running.send('quit');
    expect(stopped.snapshot?.phase).toBe('stopped');
    expect(stopped.pids).toEqual([]);
    expect(await running.exit()).toBe(0);
  },
  15_000,
);
it('desktop malformed JSON is denied while its already-loaded fixture stays ready', async () => {
  const desktop = host('desktop');
  await desktop.send('load', { selection: selection() });
  desktop.raw('{');
  expect((await desktop.send('snapshot')).snapshot?.phase).toBe('ready');
  await desktop.send('quit');
}, 15_000);
it('normal desktop Quit leaves independent headless inference fixture ready', async () => {
  const desktop = host('desktop', 'hang');
  const headless = host('headless');
  await Promise.all([
    desktop.send('load', { selection: selection() }),
    headless.send('load', { selection: selection() }),
  ]);
  expect((await desktop.send('quit')).snapshot?.phase).toBe('stopped');
  expect(await desktop.exit()).toBe(0);
  expect((await headless.send('snapshot')).snapshot?.phase).toBe('ready');
  expect((await headless.send('quit')).pids).toEqual([]);
}, 15_000);
it.each(['headless', 'desktop'] as const)(
  '%s rejects unknown commands without a native launch',
  async (kind) => {
    const running = host(kind);
    expect((await running.send('exec', { path: 'untrusted' })).error).toBe('INVALID_CONTROL');
    expect((await running.send('snapshot')).pids).toEqual([]);
    await running.send('quit');
  },
  15_000,
);
it.each(['headless', 'desktop'] as const)(
  '%s abnormal owner death removes its engine and descendant',
  async (kind) => {
    const runningHost = host(kind, 'descendant');
    const started = await runningHost.send('load', { selection: selection() });
    expect(started.pids).toHaveLength(2);
    const pids = [...(started.pids ?? []), ...(started.corePid ? [started.corePid] : [])];
    runningHost.child.kill();
    await runningHost.exit();
    await expect.poll(() => pids.filter(running), { timeout: 3_000 }).toEqual([]);
  },
  15_000,
);
it('unexpected utility core exit cleans its engine while an independent headless host remains ready', async () => {
  const desktop = host('desktop', 'descendant');
  const independent = host('headless');
  const started = await desktop.send('load', { selection: selection() });
  await independent.send('load', { selection: selection() });
  desktop.raw(JSON.stringify({ id: 2, action: 'crash-core' }));
  await desktop.exit();
  await expect.poll(() => (started.pids ?? []).filter(running), { timeout: 3_000 }).toEqual([]);
  expect((await independent.send('snapshot')).snapshot?.phase).toBe('ready');
  await independent.send('quit');
}, 15_000);
