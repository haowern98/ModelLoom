import {
  APPROVED_MEMORY_REPORTS,
  APPROVED_RUNTIME_CATALOGS,
} from '../runtime-package/trust-policy.js';
import { readApprovedRuntimeRoot } from '../runtime-package/verifier.js';
import {
  createDesktopRuntimeCatalog,
  createRuntimeCatalogManagement,
} from '../runtime-package/catalog-management.js';
import { developmentDesktopDependencies } from './development-desktop.js';

/** Reject incomplete release inputs before packaging or accepting desktop commands. */
export function releaseRuntimePolicy() {
  const root = readApprovedRuntimeRoot();
  const policy = APPROVED_RUNTIME_CATALOGS[0];
  if (APPROVED_RUNTIME_CATALOGS.length !== 1 || !policy || policy.offers.length !== 2)
    throw new Error('MISSING_RUNTIME_CATALOG');
  for (const backend of ['cuda', 'vulkan'] as const) {
    const offer = policy.offers.find(({ build }) => build.backend === backend);
    if (
      !offer ||
      !APPROVED_MEMORY_REPORTS.some(
        (report) =>
          report.backend === backend &&
          report.artifact === offer.build.artifact &&
          report.configuration.slots === 4,
      )
    )
      throw new Error('NEEDS_RESOURCE_EVIDENCE');
  }
  return { root, ...policy };
}

/** Entry point for an explicitly staged Windows release. */
export function releaseDesktopDependencies(
  ...args: Parameters<typeof developmentDesktopDependencies>
) {
  const store = args[7];
  if (!store) throw new Error('INVALID_APPLICATION_DATA');
  const { root, endpoints, offers } = releaseRuntimePolicy();
  const management = createRuntimeCatalogManagement({ root, endpoints, store });
  const catalog = createDesktopRuntimeCatalog(management, offers);
  const [fork, base, profile, caller, state, overlay, diagnostic] = args;
  return developmentDesktopDependencies(
    fork,
    base,
    profile,
    caller,
    state,
    overlay,
    diagnostic,
    store,
    false,
    catalog,
  );
}
