import { expect, test } from '@playwright/test';

for (const edge of [null, 'top', 'right', 'bottom', 'left'] as const) {
  test(`restores ${edge ?? 'legacy'} saved canvas with equal cards, visible links and fitted bounds`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((edge) => {
      const modelId = 'a'.repeat(64),
        fingerprint = 'b'.repeat(64),
        peer = `peer:${fingerprint}`;
      const uuid = 'GPU-11111111-1111-1111-1111-111111111111';
      const gpu = { id: uuid, name: 'Observed GPU', memoryBytes: 12 * 2 ** 30 };
      const load = {
        defaults: {
          automatic: false,
          contextLength: 2048,
          threads: null,
          evaluationBatch: 256,
          physicalBatch: 128,
          concurrency: 1,
          flashAttention: true,
        },
        cacheK: 'f16' as const,
        cacheV: 'f16' as const,
      };
      const column = edge === 'left' ? -1 : edge === 'right' ? 1 : 0;
      const row = edge === 'top' ? -1 : edge === 'bottom' ? 1 : 0;
      const configuration = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Saved canvas',
        revision: 1,
        modelId,
        profileId: 'fixture',
        blockCount: 8,
        load,
        runs: [
          { uuid, first: 0, last: 3 },
          { uuid: `${peer}:${uuid}`, first: 4, last: 7 },
        ],
        ...(edge
          ? {
              canvas: {
                positions: { local: { column: 0, row: 0 }, [peer]: { column, row } },
                links: [{ from: 'local', to: peer, edge }],
              },
            }
          : {}),
      };
      window.modelLoomRuntime = {
        command: () =>
          Promise.resolve({
            enabled: true,
            model: null,
            models: [
              { id: `model-${modelId}`, name: 'Bonsai fixture', size: '4 GB', blockCount: 8 },
            ],
            phase: 'stopped',
            error: null,
            device: {
              name: 'Laptop fixture',
              os: 'Windows',
              cpuName: 'CPU',
              threads: 8,
              role: 'Coordinator',
              inventory: {
                sampledAt: 1,
                gpus: [
                  {
                    ...gpu,
                    pciVendorId: '10de',
                    totalMemoryBytes: gpu.memoryBytes,
                    executionIdentity: { vendor: 'nvidia', uuid, pciBus: '00000000:01:00.0' },
                  },
                ],
              },
            },
          }),
      };
      window.modelLoomPeers = {
        command: () =>
          Promise.resolve({
            ok: true,
            view: {
              fingerprint: 'c'.repeat(64),
              name: 'Laptop fixture',
              sharing: false,
              addresses: [],
              gpus: [],
              sharedGpuIds: [],
              incoming: [],
              outgoing: [
                {
                  id: 'peer-fixture',
                  name: 'Worker fixture',
                  peerFingerprint: fingerprint,
                  phase: 'approved',
                  localVerified: true,
                  remoteVerified: true,
                  gpus: [gpu],
                  hardware: {
                    os: 'Windows',
                    cpuName: 'CPU',
                    threads: 8,
                    sampledAt: 1,
                    gpus: [gpu],
                  },
                },
              ],
            },
          }),
      };
      window.modelLoomCluster = {
        command: (input) =>
          Promise.resolve({
            ok: true,
            configurations: [configuration],
            configuration: input.action === 'read' ? configuration : null,
            draft: null,
            load,
            issues: [],
          }),
      };
    }, edge);
    await page.goto('http://127.0.0.1:5176');
    await page.getByRole('button', { name: 'Cluster', exact: true }).click();
    await page.getByRole('button', { name: 'Saved canvas', exact: true }).click();
    const local = page.getByRole('article', { name: 'Laptop fixture', exact: true });
    const remote = page.getByRole('article', { name: 'Worker fixture', exact: true });
    const check = async () => {
      await expect(local).toBeVisible();
      await expect(remote).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'Canvas layout connections' }).locator('path'),
      ).toHaveAttribute('d', /M.+/);
      await expect(
        page.getByRole('button', {
          name: 'Connection details between Laptop fixture and Worker fixture',
        }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const a = await local.boundingBox(),
            b = await remote.boundingBox();
          const viewport = await page.getByRole('region', { name: 'Cluster canvas' }).boundingBox();
          if (!a || !b || !viewport) return false;
          const inside = (rect: typeof a) =>
            rect.x >= viewport.x &&
            rect.y >= viewport.y &&
            rect.x + rect.width <= viewport.x + viewport.width + 1 &&
            rect.y + rect.height <= viewport.y + viewport.height + 1;
          const direction =
            edge === 'top'
              ? b.y + b.height < a.y
              : edge === 'bottom'
                ? b.y > a.y + a.height
                : edge === 'left'
                  ? b.x + b.width < a.x
                  : b.x > a.x + a.width;
          return Math.abs(a.width - b.width) < 1 && inside(a) && inside(b) && direction;
        })
        .toBe(true);
      await expect(page.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    };
    await check();
    await page.getByRole('button', { name: 'Models', exact: true }).click();
    await page.getByRole('button', { name: 'Cluster', exact: true }).click();
    await check();
    await page.reload();
    await page.getByRole('button', { name: 'Cluster', exact: true }).click();
    await page.getByRole('button', { name: 'Saved canvas', exact: true }).click();
    await check();
  });
}
