import { downloadRuntimeCatalogTarget } from '../src/runtime-package/catalog-download.js';

const catalog = 'https://catalog.example.invalid/';
const assets = 'https://assets.example.invalid/';

/** Exercise TUF downloads with fixture keys. The returned archive grants no install or launch authority. */
export async function downloadRuntimeFixture(
  root: Buffer,
  backend: 'cuda' | 'vulkan',
  outputDirectory: string,
  request: typeof fetch,
): Promise<string> {
  return downloadRuntimeCatalogTarget(
    root,
    backend,
    outputDirectory,
    { metadata: catalog, assets },
    request,
  );
}
