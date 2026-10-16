import { expect, it } from 'vitest';
import { captureClusterDraft } from './run-plan.js';
import { record, capabilities } from '../model-configuration/test-fixtures.js';
const draft = {
  key: `model:${record().modelId}`,
  modelId: record().modelId,
  configurationId: null,
  revision: 2,
  baseSavedRevision: null,
  load: { defaults: record().load, cacheK: 'q8_0' as const, cacheV: 'q8_0' as const },
  runs: [{ uuid: 'GPU-12345678-1234-1234-1234-123456789abc', first: '0', last: '63' }],
};
const id = '12345678-1234-4234-8234-123456789abc';
it('captures a valid draft without naming or saving it', () => {
  const captured = captureClusterDraft(draft, 2, 64, capabilities.profileId, id);
  expect(captured).toMatchObject({
    id,
    modelId: draft.modelId,
    revision: 2,
    load: draft.load,
    runs: [{ uuid: draft.runs[0]!.uuid, first: 0, last: 63 }],
  });
  expect(draft.configurationId).toBeNull();
  expect(draft.runs[0]!.last).toBe('63');
});
it('rejects stale, empty and incomplete drafts before launch', () => {
  expect(() => captureClusterDraft(draft, 1, 64, capabilities.profileId, id)).toThrow(
    'STALE_CONFIGURATION',
  );
  for (const runs of [[], [{ ...draft.runs[0]!, last: '62' }], [{ ...draft.runs[0]!, first: '' }]])
    expect(() =>
      captureClusterDraft({ ...draft, runs }, 2, 64, capabilities.profileId, id),
    ).toThrow('INVALID_CLUSTER_CONFIGURATION');
});
