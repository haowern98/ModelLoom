import { expect, it } from 'vitest';
import { decodeConfigurationCommand, decodeConfigurationReply } from './wire.js';
import { record } from './test-fixtures.js';
import { decodeModelConfiguration } from './contracts.js';

it('accepts only read/save data and rejects privileged or oversized management payloads', () => {
  expect(decodeConfigurationCommand({ action: 'read', modelId: record().modelId })).toEqual({
    action: 'read',
    modelId: record().modelId,
  });
  expect(
    decodeConfigurationCommand({
      action: 'save',
      modelId: record().modelId,
      expectedRevision: 3,
      record: record(),
    }).action,
  ).toBe('save');
  for (const input of [
    { action: 'read', modelId: record().modelId, path: 'private' },
    { action: 'read', modelId: 'demo-qwen' },
    { action: 'save', modelId: record().modelId, expectedRevision: 2, record: record() },
    {
      action: 'save',
      modelId: record().modelId,
      expectedRevision: 3,
      record: { ...record(), engineUrl: 'private' },
    },
  ])
    expect(() => decodeConfigurationCommand(input)).toThrow(/^INVALID_CONTROL$/);
});

it('copies bounded non-secret replies and rejects forged status/exception fields', () => {
  const input = {
    ok: true,
    record: record(),
    defaults: { ...record(), revision: 0 },
    pendingReload: true,
    maxOutputTokens: 512,
    thinkingSupported: false,
  };
  const output = decodeConfigurationReply(input);
  expect(output).toEqual({
    ...input,
    record: decodeModelConfiguration(input.record, { contextLimit: 2147483647 }),
    defaults: decodeModelConfiguration(input.defaults, { contextLimit: 2147483647 }),
  });
  expect(output).not.toBe(input);
  expect(() => decodeConfigurationReply({ ...input, secret: 'private' })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() => decodeConfigurationReply({ ...input, maxOutputTokens: NaN })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() => decodeConfigurationReply({ ok: false, error: 'private path' })).toThrow(
    'INVALID_CONTROL',
  );
  expect(decodeConfigurationReply({ ok: false, error: 'STALE_CONFIGURATION' })).toEqual({
    ok: false,
    error: 'STALE_CONFIGURATION',
  });
});
