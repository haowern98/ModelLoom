import type { RuntimePackageDescription } from '../../../../packages/core/src/runtime-package/inventory';

export type CatalogBackend = 'cuda' | 'vulkan';
export type CatalogCommand =
  { action: 'read' } | { action: 'install' | 'select'; backend: CatalogBackend };

export interface CatalogSnapshot {
  installed: RuntimePackageDescription[];
  selected: RuntimePackageDescription | null;
  offers: readonly { build: RuntimePackageDescription; size: string }[];
}

export function decodeCatalogCommand(input: unknown): CatalogCommand {
  if (!input || typeof input !== 'object') throw new Error('INVALID_CONTROL');
  const command = input as Record<string, unknown>;
  const { action, backend } = command;
  if (action === 'read' && Object.keys(command).length === 1) return { action };
  if (
    (action === 'install' || action === 'select') &&
    (backend === 'cuda' || backend === 'vulkan') &&
    Object.keys(command).length === 2
  )
    return { action, backend };
  throw new Error('INVALID_CONTROL');
}

declare global {
  interface Window {
    modelLoomRuntimeCatalog?: {
      command(input: CatalogCommand): Promise<CatalogSnapshot | null>;
    };
  }
}
