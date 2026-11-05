import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  decodePeerResources,
  peerRuntimeId,
  rpcClientRuntimeId,
  requireCompatibleRpcRuntime,
  RPC_RUNTIME_FILES,
} from './resources.js';
import { inventory } from '../../tests/inventory-fixture.js';
import type { Inventory } from '../runtime-package/inventory.js';
import {
  VULKAN_DEVELOPMENT,
  isDevelopmentVulkanInventory,
} from '../runtime-package/development-vulkan.js';
import { parseInventory } from '../runtime-package/inventory.js';

it('accepts the exact paired CUDA/Vulkan payloads in both coordinator directions', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../tests/vulkan-inventories.json', import.meta.url), 'utf8'),
  ) as { cuda: unknown; cudaPeer: unknown; vulkan: unknown };
  const cuda = parseInventory(fixture.cuda);
  const peer = parseInventory(fixture.cudaPeer);
  const vulkan = parseInventory(fixture.vulkan);
  expect(isDevelopmentVulkanInventory(vulkan)).toBe(true);
  const local = {
    runtimeId: peerRuntimeId(peer),
    clientRuntimeId: rpcClientRuntimeId(cuda),
    ram: 8192,
    gpus: [],
  };
  const remote = {
    runtimeId: peerRuntimeId(vulkan),
    clientRuntimeId: rpcClientRuntimeId(vulkan),
    ram: 8192,
    gpus: [],
  };
  expect(() => requireCompatibleRpcRuntime(cuda, local, remote)).not.toThrow();
  expect(() => requireCompatibleRpcRuntime(vulkan, remote, local)).not.toThrow();
  expect(() =>
    peerRuntimeId({
      ...vulkan,
      files: vulkan.files.map((file) =>
        file.path === 'ggml-rpc.dll' ? { ...file, sha256: '0'.repeat(64) } : file,
      ),
    }),
  ).toThrow('RPC_PACKAGE_REQUIRED');
});

it('allows only the qualified CUDA/Vulkan payload pair and rejects an altered client', () => {
  const coordinator = {
    ...inventory,
    backend: 'cuda',
    artifact: 'b11306-cuda12.4-msvc14.44-dev1',
    upstreamCommit: VULKAN_DEVELOPMENT.upstreamCommit,
    files: RPC_RUNTIME_FILES.filter((name) => name !== 'ggml-rpc-server.exe').map((path) => ({
      path,
      length: 1,
      sha256: 'a'.repeat(64),
    })),
  } as Inventory;
  const local = {
    runtimeId: '6b1e4eecd5fba9b281da51fb5b85b92c0a41ff9df5258134723e12ad47d2721b',
    clientRuntimeId: rpcClientRuntimeId(coordinator),
    ram: 8192,
    gpus: [],
  };
  const remote = {
    ...local,
    runtimeId: '654df43c276228dcee97eb1a3b80fdc992d3b7b326a12b0e22137a3b917af1fa',
    clientRuntimeId: 'a175ea49398005d12cb0737a794d7c7a06b53d35009e7359f431ebda46e98c32',
  };
  // A matching peer label cannot qualify a coordinator whose payload differs.
  expect(() => requireCompatibleRpcRuntime(coordinator, local, remote)).toThrow(
    'INCOMPATIBLE_RUNTIME',
  );
});

it('binds runtime compatibility to the full required stock payload', () => {
  const signed: Inventory = {
    ...inventory,
    schemaVersion: 1,
    platform: 'win32',
    arch: 'x64',
    protocol: 1,
    stop: 'private-console-ctrl-c',
    backend: 'cuda' as const,
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    files: RPC_RUNTIME_FILES.map((path) => ({ path, length: 1, sha256: 'a'.repeat(64) })),
  };
  expect(peerRuntimeId(signed)).not.toBe(
    peerRuntimeId({
      ...signed,
      files: signed.files.map((file, i) => (i ? file : { ...file, sha256: 'b'.repeat(64) })),
    }),
  );
  expect(() => peerRuntimeId({ ...signed, files: signed.files.slice(1) })).toThrow(
    'RPC_PACKAGE_REQUIRED',
  );
});
it('rejects incomplete, oversized and inconsistent selected hardware observations', () => {
  const gpu = {
    uuid: 'GPU-11111111-1111-1111-1111-111111111111',
    bus: '00000000:01:00.0',
    driver: '617.14',
    total: 4096,
    free: 1024,
    mig: '[N/A]',
    driverModel: 'WDDM',
  };
  const report = { runtimeId: 'a'.repeat(64), ram: 8192, gpus: [gpu] };
  expect(decodePeerResources(report).gpus).toHaveLength(1);
  expect(() => decodePeerResources({ ...report, gpus: [{ ...gpu, free: 8192 }] })).toThrow(
    'NEEDS_RESOURCE_EVIDENCE',
  );
  expect(() => decodePeerResources({ ...report, gpus: [gpu, gpu] })).toThrow(
    'NEEDS_RESOURCE_EVIDENCE',
  );
  expect(() => decodePeerResources({ ...report, ram: null })).toThrow('NEEDS_RESOURCE_EVIDENCE');
  expect(decodePeerResources({ ...report, clientRuntimeId: 'b'.repeat(64) }).clientRuntimeId).toBe(
    'b'.repeat(64),
  );
  expect(() => decodePeerResources({ ...report, clientRuntimeId: 'invalid' })).toThrow();
});

it('rejects a coordinator RPC library mismatch before launching matching workers', () => {
  const coordinator: Inventory = {
    ...inventory,
    schemaVersion: 1,
    platform: 'win32',
    arch: 'x64',
    stop: 'private-console-ctrl-c',
    protocol: 1,
    backend: 'cuda',
    version: 'b11306-dev10-tensor-cache-v1',
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
    files: RPC_RUNTIME_FILES.filter((name) => name !== 'ggml-rpc-server.exe').map((path) => ({
      path,
      length: 1,
      sha256: 'a'.repeat(64),
    })),
  };
  const worker = {
    runtimeId: 'c'.repeat(64),
    clientRuntimeId: rpcClientRuntimeId(coordinator),
    ram: 8192,
    gpus: [],
  };
  expect(() => requireCompatibleRpcRuntime(coordinator, worker, worker)).not.toThrow();
  const old = {
    ...coordinator,
    files: coordinator.files.map((file) =>
      file.path === 'ggml-rpc.dll' ? { ...file, sha256: 'b'.repeat(64) } : file,
    ),
  };
  expect(() => requireCompatibleRpcRuntime(old, worker, worker)).toThrow('INCOMPATIBLE_RUNTIME');
  expect(() =>
    requireCompatibleRpcRuntime(coordinator, worker, { ...worker, runtimeId: 'd'.repeat(64) }),
  ).toThrow('INCOMPATIBLE_RUNTIME');
  expect(() =>
    requireCompatibleRpcRuntime(coordinator, worker, {
      ...worker,
      clientRuntimeId: 'e'.repeat(64),
    }),
  ).toThrow('INCOMPATIBLE_RUNTIME');
  const legacy = { runtimeId: worker.runtimeId, ram: 8192, gpus: [] };
  expect(() => requireCompatibleRpcRuntime(coordinator, legacy, legacy)).toThrow(
    'INCOMPATIBLE_RUNTIME',
  );
});
