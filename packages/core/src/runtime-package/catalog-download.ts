import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Updater } from 'tuf-js';
import { DownloadHTTPError } from 'tuf-js/dist/error.js';
import { BaseFetcher } from 'tuf-js/dist/fetcher.js';
import { METADATA_LIMIT, PACKAGE_LIMIT } from './inventory.js';

const runtimeTargets = {
  cuda: 'runtime-b11306-cuda.zip',
  vulkan: 'runtime-b11306-vulkan.zip',
} as const;

class RuntimeCatalogFetcher extends BaseFetcher {
  private hashedTarget: string | undefined;
  constructor(
    private readonly request: typeof fetch,
    private readonly metadata: URL,
    private readonly target: URL,
  ) {
    super();
  }

  authorizeHash(hash: string) {
    const filename = this.target.pathname.split('/').at(-1)!;
    this.hashedTarget = new URL(`${hash}.${filename}`, this.target).href;
  }

  async fetch(url: string) {
    const requested = new URL(url);
    const metadataFile =
      requested.href.startsWith(this.metadata.href) &&
      /^(?:[1-9][0-9]*\.)?(?:root|timestamp|snapshot|targets)\.json$/u.test(
        requested.href.slice(this.metadata.href.length),
      );
    if (
      !metadataFile &&
      requested.href !== this.target.href &&
      requested.href !== this.hashedTarget
    )
      throw new Error('INVALID_CATALOG_URL');
    const githubAsset =
      !metadataFile &&
      requested.origin === 'https://github.com' &&
      /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/u.test(requested.pathname);
    const signal = AbortSignal.timeout(metadataFile ? 30_000 : 60 * 60_000);
    let response = await this.request(url, { redirect: githubAsset ? 'manual' : 'error', signal });
    if (githubAsset && [301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      const destination = location ? new URL(location, requested) : undefined;
      if (
        destination?.origin !== 'https://release-assets.githubusercontent.com' ||
        destination.username ||
        destination.password ||
        destination.hash ||
        !destination.pathname.startsWith('/github-production-release-asset/')
      )
        throw new Error('INVALID_CATALOG_URL');
      response = await this.request(destination.href, { redirect: 'error', signal });
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new DownloadHTTPError('Runtime catalog download failed', response.status);
    }
    return response.body;
  }
}

function catalogBase(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/')
  )
    throw new Error('INVALID_CATALOG_URL');
  return url;
}

/** Downloads a catalog target using roots and endpoints supplied by the trusted host.
 * The archive is data only. Installation and activation require separate package verification.
 */
export async function downloadRuntimeCatalogTarget(
  root: Buffer,
  backend: keyof typeof runtimeTargets,
  outputDirectory: string,
  endpoints: { metadata: string; assets: string },
  request: typeof fetch = fetch,
): Promise<string> {
  if (root.length > METADATA_LIMIT) throw new Error('INVALID_TRUST_ROOT');
  const filename = runtimeTargets[backend];
  const metadata = catalogBase(endpoints.metadata);
  const assets = catalogBase(endpoints.assets);
  const work = await mkdtemp(path.join(outputDirectory, '.runtime-catalog-'));
  try {
    await writeFile(path.join(work, 'root.json'), root, { flag: 'wx' });
    const fetcher = new RuntimeCatalogFetcher(request, metadata, new URL(filename, assets));
    const updater = new Updater({
      metadataDir: work,
      metadataBaseUrl: metadata.href,
      targetBaseUrl: assets.href,
      fetcher,
      config: {
        rootMaxLength: METADATA_LIMIT,
        timestampMaxLength: METADATA_LIMIT,
        snapshotMaxLength: METADATA_LIMIT,
        targetsMaxLength: METADATA_LIMIT,
        maxRootRotations: 32,
        maxDelegations: 0,
      },
    });
    const target = await updater.getTargetInfo(filename);
    if (
      !target ||
      !Number.isSafeInteger(target.length) ||
      target.length < 1 ||
      target.length > PACKAGE_LIMIT ||
      !/^[a-f0-9]{64}$/u.test(target.hashes.sha256 ?? '')
    )
      throw new Error('INVALID_RUNTIME_TARGET');
    fetcher.authorizeHash(target.hashes.sha256!);

    const staged = await updater.downloadTarget(target, path.join(work, filename));
    const destination = path.join(outputDirectory, filename);
    await link(staged, destination);
    return destination;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
