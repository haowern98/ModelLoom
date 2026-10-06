import type { RuntimeConfiguration } from '../runtime/preflight.js';
import { checkResources } from '../runtime/preflight.js';
/** Closed supported configuration. Unsupported selected controls fail instead of being silently omitted. */
export function fixedArguments(
  model: string,
  configuration: RuntimeConfiguration | Record<string, unknown>,
  port: number,
  keyFile: string,
  alias: string,
): readonly string[] {
  const keys = [
    'modelSha256',
    'contextPerSlot',
    'slots',
    'gpuLayers',
    'cacheK',
    'cacheV',
    'seed',
    'temperature',
  ];
  if (
    Object.keys(configuration).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(configuration, key)) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(alias) ||
    [model, keyFile].some(
      (value) =>
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 32700 ||
        value.includes('\0'),
    )
  )
    throw new Error('INVALID_CONFIGURATION');
  const cfg = configuration as RuntimeConfiguration;
  if (
    checkResources(cfg, '', 'cpu', undefined, { ram: 0, vram: 0 }).code === 'INVALID_CONFIGURATION'
  )
    throw new Error('INVALID_CONFIGURATION');
  return Object.freeze([
    '--model',
    model,
    '--alias',
    alias,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--api-key-file',
    keyFile,
    '--no-ui',
    '--no-agent',
    '--no-ui-mcp-proxy',
    '--no-mmproj',
    '--fit',
    'off',
    '--ctx-size',
    String(cfg.contextPerSlot * cfg.slots),
    '--parallel',
    String(cfg.slots),
    '--n-gpu-layers',
    String(cfg.gpuLayers),
    '--cache-type-k',
    cfg.cacheK,
    '--cache-type-v',
    cfg.cacheV,
    '--seed',
    String(cfg.seed),
    '--temp',
    String(cfg.temperature),
  ]);
}
