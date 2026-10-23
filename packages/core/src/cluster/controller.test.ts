import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ModelConfigurationStore } from '../model-configuration/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { ClusterController } from './controller.js';
import { decodeClusterCommand, decodeClusterReply } from './wire.js';
it('keeps management caller-bound and rejects authority-bearing fields', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new ModelConfigurationStore(
      db,
      () => {},
      () => true,
      capabilities,
      record().load,
    );
    const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
    expect(await controller.command('forged', { action: 'list' })).toEqual({
      ok: false,
      error: 'NOT_READY',
    });
    expect(await controller.command('window', { action: 'list', path: 'E:\\secret' })).toEqual({
      ok: false,
      error: 'INVALID_CONTROL',
    });
    expect(
      (
        await controller.command('window', {
          action: 'read',
          modelId: record().modelId,
          configurationId: null,
        })
      ).ok,
    ).toBe(true);
    await controller.close();
    expect(await controller.command('window', { action: 'list' })).toEqual({
      ok: false,
      error: 'NOT_READY',
    });
  } finally {
    db.close();
  }
});
it.each([
  { action: 'list', args: [] },
  { action: 'save', key: 'model:' + 'a'.repeat(64), revision: 0, name: 'Name' },
  { action: 'read', modelId: 'path', configurationId: null },
  { action: 'cancel-planning', receipt: {} },
  { action: 'delete', id: '../other', revision: 1 },
  { action: 'delete', id: '12345678-1234-4234-8234-123456789abc', revision: 0 },
  { action: 'delete', id: '12345678-1234-4234-8234-123456789abc', revision: 1, path: 'E:\\secret' },
])('rejects malformed control %o', (input) => {
  expect(() => decodeClusterCommand(input)).toThrow('INVALID_CONTROL');
});
it('accepts only an exact revision-bound delete command', () => {
  const command = { action: 'delete', id: '12345678-1234-4234-8234-123456789abc', revision: 1 };
  expect(decodeClusterCommand(command)).toEqual(command);
});
it('rejects raw host exception replies', () => {
  expect(() => decodeClusterReply({ ok: false, error: 'C:\\secret' })).toThrow('INVALID_CONTROL');
});
it('captures only bounded unique physical or qualified GPU selections for automatic placement', () => {
  const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
  const command = {
    action: 'auto-place',
    key: 'model:' + 'a'.repeat(64),
    revision: 1,
    devices: [uuid, `peer:${'b'.repeat(64)}:${uuid}`],
  };
  expect(decodeClusterCommand(command)).toEqual(command);
  expect(decodeClusterCommand({ ...command, devices: [] })).toEqual({ ...command, devices: [] });
  for (const devices of [[uuid, uuid], ['address'], Array(17).fill(uuid), [42], 'all'])
    expect(() => decodeClusterCommand({ ...command, devices })).toThrow('INVALID_CONTROL');
});
