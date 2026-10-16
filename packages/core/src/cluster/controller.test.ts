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
])('rejects malformed control %o', (input) => {
  expect(() => decodeClusterCommand(input)).toThrow('INVALID_CONTROL');
});
it('rejects raw host exception replies', () => {
  expect(() => decodeClusterReply({ ok: false, error: 'C:\\secret' })).toThrow('INVALID_CONTROL');
});
