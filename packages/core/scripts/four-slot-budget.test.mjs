import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticBudget, admitsDiagnostic } from './four-slot-budget.mjs';
const snapshot = {
  ram: 8 * 1024 ** 3,
  gpus: [{ uuid: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a', free: 7 * 1024 ** 3 }],
};
test('calibration can start with eight GiB while preserving a measured baseline and additional slot reserves', () => {
  assert.equal(admitsDiagnostic(snapshot), true);
  assert.ok(diagnosticBudget.ram > 4986970112 + 3 * 2 * 151 * 1048576);
  assert.ok(diagnosticBudget.ram < 8 * 1024 ** 3);
});
test('rejects unknown memory, insufficient memory and a different physical GPU', () => {
  for (const ram of [null, undefined, NaN, Infinity, -1, 4 * 1024 ** 3, diagnosticBudget.ram - 1])
    assert.equal(admitsDiagnostic({ ...snapshot, ram }), false);
  for (const free of [null, undefined, NaN, Infinity, -1, diagnosticBudget.vram - 1])
    assert.equal(admitsDiagnostic({ ...snapshot, gpus: [{ ...snapshot.gpus[0], free }] }), false);
  assert.equal(admitsDiagnostic({ ...snapshot, gpus: null }), false);
  assert.equal(
    admitsDiagnostic({ ...snapshot, gpus: [{ ...snapshot.gpus[0], uuid: 'other' }] }),
    false,
  );
});
