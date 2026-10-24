import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, it } from 'vitest';

it('checks native private-address and stale-rule ownership parsing without elevation', () => {
  const output = execFileSync(
    path.resolve('out/network-guard-probe/network-guard-probe.exe'),
    ['--sharing-policy-fixture'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    },
  );
  expect(JSON.parse(output)).toEqual({
    phase: 'sharing-policy-checked',
    addresses: 14,
    records: 8,
  });
});
