import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { inventory } from '../../tests/inventory-fixture.js';
import { repository } from '../../tests/package-repository.js';
import { downloadRuntimeFixture } from '../../tests/runtime-catalog.js';
import { downloadRuntimeCatalogTarget } from './catalog-download.js';

const cuda = 'runtime-b11306-cuda.zip';
const vulkan = 'runtime-b11306-vulkan.zip';
const artifacts = {
  [cuda]: Buffer.from('cuda test bytes'),
  [vulkan]: Buffer.from('vulkan test bytes'),
};
let work: string;
let output: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), 'modelloom-catalog-'));
  output = await mkdtemp(path.join(work, 'out-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : input);
}

function request(assets: Record<string, Buffer> = artifacts) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = requestUrl(input);
    const name = url.pathname.slice(1);
    if (url.origin === 'https://assets.example.invalid') {
      const bytes = assets[name];
      return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
    }
    expect(url.origin).toBe('https://catalog.example.invalid');
    if (name === '2.root.json') return new Response(null, { status: 404 });
    return new Response(new Uint8Array(await readFile(path.join(work, name))));
  });
}

test.each([
  ['cuda', cuda],
  ['vulkan', vulkan],
] as const)('downloads and verifies only the selected %s target', async (backend, filename) => {
  const { root } = await repository(work, inventory, undefined, artifacts);
  const fetchFixture = request();
  const destination = await downloadRuntimeFixture(root, backend, output, fetchFixture);

  expect(await readFile(destination)).toEqual(artifacts[filename]);
  expect(await readdir(output)).toEqual([filename]);
  expect(
    fetchFixture.mock.calls
      .map(([url]) => requestUrl(url).href)
      .filter((url) => url.startsWith('https://assets.example.invalid/')),
  ).toEqual([`https://assets.example.invalid/${filename}`]);
});

test('downloads the hash-prefixed target from a consistent snapshot catalog', async () => {
  const { root, digest } = await repository(work, inventory, undefined, artifacts, true);
  const filename = `${digest(artifacts[vulkan]).hashes.sha256}.${vulkan}`;
  const fetchFixture = request({ [filename]: artifacts[vulkan] });

  const destination = await downloadRuntimeFixture(root, 'vulkan', output, fetchFixture);

  expect(await readFile(destination)).toEqual(artifacts[vulkan]);
  expect(fetchFixture.mock.calls.map(([url]) => requestUrl(url).pathname)).toContain(
    `/${filename}`,
  );
});

test('rejects a tampered archive and leaves no staged output', async () => {
  const { root } = await repository(work, inventory, undefined, artifacts);
  const tampered = Buffer.alloc(artifacts[cuda].length, 1);
  await expect(
    downloadRuntimeFixture(root, 'cuda', output, request({ ...artifacts, [cuda]: tampered })),
  ).rejects.toThrow();
  expect(await readdir(output)).toEqual([]);
});

test.each([
  [
    'https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?sig=fixture',
    true,
  ],
  ['https://example.invalid/github-production-release-asset/123/abc', false],
] as const)('validates a GitHub release redirect to %s', async (redirect, allowed) => {
  const { root, digest } = await repository(work, inventory, undefined, artifacts, true);
  const assetBase = 'https://github.com/owner/project/releases/download/runtime-v1/';
  const asset = new URL(`${digest(artifacts[cuda]).hashes.sha256}.${cuda}`, assetBase).href;
  const metadata = request();
  const fetchFixture = vi.fn<typeof fetch>((input, init) => {
    const url = requestUrl(input).href;
    if (url === asset) {
      expect(init?.redirect).toBe('manual');
      return Promise.resolve(Response.redirect(redirect, 302));
    }
    if (url === redirect) {
      expect(init?.redirect).toBe('error');
      return Promise.resolve(new Response(new Uint8Array(artifacts[cuda])));
    }
    return metadata(input, init);
  });
  const download = downloadRuntimeCatalogTarget(
    root,
    'cuda',
    output,
    { metadata: 'https://catalog.example.invalid/', assets: assetBase },
    fetchFixture,
  );
  if (allowed) expect(await readFile(await download)).toEqual(artifacts[cuda]);
  else await expect(download).rejects.toThrow();
  expect(fetchFixture.mock.calls.some(([url]) => requestUrl(url).href === redirect)).toBe(allowed);
});

test('rejects a non-HTTPS catalog before making a request', async () => {
  const fetchFixture = request();
  await expect(
    downloadRuntimeCatalogTarget(
      Buffer.from('{}'),
      'cuda',
      output,
      { metadata: 'http://catalog.example.invalid/', assets: 'https://assets.example.invalid/' },
      fetchFixture,
    ),
  ).rejects.toThrow('INVALID_CATALOG_URL');
  expect(fetchFixture).not.toHaveBeenCalled();
  expect(await readdir(output)).toEqual([]);
});

test('rejects expired metadata before requesting the archive', async () => {
  const { root, envelope, digest } = await repository(work, inventory, undefined, artifacts);
  const snapshot = await readFile(path.join(work, 'snapshot.json'));
  await writeFile(
    path.join(work, 'timestamp.json'),
    envelope(
      {
        _type: 'timestamp',
        spec_version: '1.0.31',
        version: 1,
        expires: '2020-01-01T00:00:00Z',
        meta: { 'snapshot.json': digest(snapshot) },
      },
      [3],
    ),
  );
  const fetchFixture = request();
  await expect(downloadRuntimeFixture(root, 'cuda', output, fetchFixture)).rejects.toThrow();
  expect(
    fetchFixture.mock.calls.some(
      ([url]) => requestUrl(url).origin === 'https://assets.example.invalid',
    ),
  ).toBe(false);
  expect(await readdir(output)).toEqual([]);
});
