import { afterEach, expect, it } from 'vitest';
import { createFixtureDeployment } from './fixture-engine.js';
import type { FixtureDeployment } from './fixture-engine.js';
import { RuntimeSupervisor } from '../runtime/supervisor.js';
import type { Selection } from '../runtime/contracts.js';
import { ownershipBinding } from './windows-ownership.js';

const owners: FixtureDeployment[] = [];
const policy = { startupMs: 3_000, gracefulStopMs: 200, forcedExitMs: 2_000 };
const selection = (id = 'd1', operationId = 'op1'): Selection => ({
  deploymentId: id,
  sessionId: 's1',
  operationId,
  packageId: 'fixture',
  modelId: 'fixture',
});
function owner(): FixtureDeployment {
  const created = createFixtureDeployment();
  owners.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(owners.splice(0).map((deployment) => deployment.close()));
});
it('gracefully stops an actual owned native child and explicitly reloads', async () => {
  const deployment = owner();
  const core = new RuntimeSupervisor('d1', deployment.adapter(), policy);
  expect((await core.load(selection())).phase).toBe('ready');
  expect(deployment.children().length).toBe(1);
  expect((await core.stop()).phase).toBe('stopped');
  expect(deployment.children()).toEqual([]);
  expect((await core.load(selection('d1', 'op2'))).phase).toBe('ready');
  expect((await core.stop()).phase).toBe('stopped');
});
it('forces a hung engine and its real descendant within the cleanup deadline', async () => {
  const deployment = owner();
  const core = new RuntimeSupervisor('d1', deployment.adapter('descendant'), policy);
  expect((await core.load(selection())).phase).toBe('ready');
  expect(deployment.children().length).toBe(2);
  expect((await core.stop()).phase).toBe('stopped');
  expect(deployment.children()).toEqual([]);
});
it('a real native abort interrupts partial text while its host stays usable', async () => {
  const deployment = owner();
  const core = new RuntimeSupervisor('d1', deployment.adapter(), policy);
  await core.load(selection());
  const identity = { deploymentId: 'd1', sessionId: 's1', operationId: 'op1', requestId: 'r1' };
  core.record({ type: 'request-started', ...identity });
  core.record({ type: 'text', ...identity, text: 'partial' });
  deployment.crash();
  await expect.poll(() => core.snapshot().phase, { timeout: 3_000 }).toBe('failed');
  expect(core.snapshot().requests.r1).toMatchObject({ text: 'partial', status: 'interrupted' });
  expect((await core.load(selection('d1', 'op2'))).phase).toBe('ready');
  await core.stop();
});
it('quitting one deployment leaves an independently owned engine alive', async () => {
  const first = owner();
  const second = owner();
  const a = new RuntimeSupervisor('d1', first.adapter('hang'), policy);
  const b = new RuntimeSupervisor('d2', second.adapter(), policy);
  await Promise.all([a.load(selection()), b.load(selection('d2'))]);
  await first.close();
  await expect.poll(() => a.snapshot().phase).toBe('failed');
  expect(b.snapshot().phase).toBe('ready');
  expect(second.children()).toHaveLength(1);
  expect((await b.stop()).phase).toBe('stopped');
});
it('abort during loading cleans its captured child without reaching ready', async () => {
  const deployment = owner();
  const core = new RuntimeSupervisor('d1', deployment.adapter('loading'), policy);
  const load = core.load(selection());
  await expect.poll(() => core.snapshot().phase).toBe('loading');
  expect((await core.stop()).phase).toBe('stopped');
  expect((await load).phase).not.toBe('ready');
  expect(deployment.children()).toEqual([]);
});
it('a closed deployment refuses further native launches', async () => {
  const deployment = owner();
  await deployment.close();
  const core = new RuntimeSupervisor('d1', deployment.adapter(), policy);
  expect((await core.load(selection())).phase).toBe('failed');
  expect(deployment.children()).toEqual([]);
});
it('native ownership rejects fabricated and wrong-kind handles without launching', () => {
  const native = ownershipBinding();
  const root = native.createDeployment();
  try {
    expect(() => native.launch({}, 'invalid.exe', ['ready'])).toThrow('INVALID_CONTROL');
    expect(() => native.observe(root)).toThrow('INVALID_CONTROL');
    expect(() => native.forceStop({})).toThrow('INVALID_CONTROL');
    expect(() => native.admitCore(root, process.pid, 'invalid.exe', Date.now())).toThrow(
      'OWNERSHIP_FAILED',
    );
    expect(() =>
      native.admitCore(root, process.pid, process.execPath, Date.now() + 60_000),
    ).toThrow('OWNERSHIP_FAILED');
  } finally {
    native.closeDeployment(root);
  }
});
it('fixture admission refuses a package/model identity outside the fixture harness', async () => {
  const deployment = owner();
  const core = new RuntimeSupervisor('d1', deployment.adapter(), policy);
  const refused = await core.load({ ...selection(), packageId: 'unverified-runtime' });
  expect(refused.phase).toBe('failed');
  expect(deployment.children()).toEqual([]);
});
