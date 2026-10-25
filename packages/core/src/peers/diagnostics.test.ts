import { expect, it } from 'vitest';
import { DiagnosticAdmission, DIAGNOSTIC_MS } from './diagnostics.js';

it('serializes probes, enforces per-direction cooldown and cancels before runtime admission', () => {
  const gate = new DiagnosticAdmission();
  const first = gate.acquire('peer:download', 0);
  expect(() => gate.acquire('other:download', 1)).toThrow('DIAGNOSTICS_BUSY');
  gate.cancel();
  expect(first.signal.aborted).toBe(true);
  const second = gate.acquire('peer:upload', 2);
  first.release();
  expect(() => gate.acquire('other:download', 3)).toThrow('DIAGNOSTICS_BUSY');
  second.release();
  expect(() => gate.acquire('peer:download', 59999)).toThrow('DIAGNOSTICS_BUSY');
  const retry = gate.acquire('peer:download', 60000);
  retry.release();
});

it('bounds cooldown entries even when an authenticated client invents test IDs', () => {
  const gate = new DiagnosticAdmission();
  for (let i = 0; i < 16; i++) gate.acquire(String(i), 0).release();
  expect(() => gate.acquire('17', 1)).toThrow('DIAGNOSTICS_BUSY');
  gate.acquire('17', 60000).release();
});

it('allows two directional probe budgets before expiring a complete idle measurement', async () => {
  const gate = new DiagnosticAdmission();
  const probe = gate.acquire('out:peer');
  try {
    await new Promise((resolve) => setTimeout(resolve, DIAGNOSTIC_MS + 50));
    expect(probe.signal.aborted).toBe(false);
  } finally {
    gate.cancel();
    probe.release();
  }
}, 15000);
