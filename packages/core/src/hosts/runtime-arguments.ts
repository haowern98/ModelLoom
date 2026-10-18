import type { RuntimeConfiguration } from '../runtime/preflight.js';
import { checkResources, SERVER_CACHE_POLICY } from '../runtime/preflight.js';
import type { ClusterEffectiveLoad } from '../cluster/effective-load.js';
import { clusterLoadArguments } from '../cluster/effective-load.js';

/** Trusted plan compiler only. Native receipt and resource admission still precede launch. */
export function clusterServerArguments(
  model: string,
  load: ClusterEffectiveLoad,
  port: number,
  keyFile: string,
  alias: string,
): readonly string[] {
  validateEndpoint(model, port, keyFile, alias);
  // Generation settings are captured by the existing request owner, not this load configuration.
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
    '--slots',
    // Slots are assigned by ModelLoom. Avoid native RAM-cache swapping that blocks /slots replies.
    '--slot-prompt-similarity',
    '0',
    load.preferences && load.preferences.overflow !== 'stop'
      ? '--context-shift'
      : '--no-context-shift',
    '--no-agent',
    '--no-ui-mcp-proxy',
    '--no-mmproj',
    '--fit',
    'off',
    '--cache-ram',
    String(load.serverCaches.promptCacheMiB),
    '--ctx-checkpoints',
    String(load.serverCaches.contextCheckpoints),
    ...clusterLoadArguments(load),
    ...(load.preferences?.reasoningBudget.enabled
      ? ['--reasoning-budget', String(load.preferences.reasoningBudget.value)]
      : []),
    ...(load.preferences?.reasoningBudget.enabled && load.preferences.reasoningMessage
      ? ['--reasoning-budget-message', load.preferences.reasoningMessage]
      : []),
    ...(load.preferences?.customTemplate
      ? ['--jinja', '--chat-template', load.preferences.chatTemplate]
      : []),
  ]);
}
function validateEndpoint(model: string, port: number, keyFile: string, alias: string): void {
  if (
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
    throw Error('INVALID_CONFIGURATION');
}
/** Closed supported configuration. Unsupported selected controls fail instead of being silently omitted. */
export function fixedArguments(
  model: string,
  configuration: RuntimeConfiguration | Record<string, unknown>,
  port: number,
  keyFile: string,
  alias: string,
): readonly string[] {
  validateEndpoint(model, port, keyFile, alias);
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
  if (Object.hasOwn(configuration, 'gpuDevice')) keys.push('gpuDevice');
  if (
    Object.keys(configuration).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(configuration, key))
  )
    throw new Error('INVALID_CONFIGURATION');
  const cfg = configuration as RuntimeConfiguration;
  if (
    (cfg.gpuLayers > 0 && !cfg.gpuDevice) ||
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
    '--slots',
    // Keep in-slot KV reuse without synchronous cross-prompt RAM-cache restoration.
    '--slot-prompt-similarity',
    '0',
    '--no-context-shift',
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
    '--device',
    cfg.gpuDevice ? 'CUDA0' : 'none',
    '--split-mode',
    'none',
    '--main-gpu',
    '0',
    '--cache-type-k',
    cfg.cacheK,
    '--cache-type-v',
    cfg.cacheV,
    // Quantized CUDA value cache uses the same explicit mode as the validated Bonsai run.
    ...(cfg.gpuDevice && cfg.cacheV === 'q8_0' ? ['--flash-attn', 'on'] : []),
    '--cache-ram',
    String(SERVER_CACHE_POLICY.promptCacheMiB),
    '--ctx-checkpoints',
    String(SERVER_CACHE_POLICY.contextCheckpoints),
    '--seed',
    String(cfg.seed),
    '--temp',
    String(cfg.temperature),
  ]);
}

/** Refuse a selected overflow policy when the native context cannot implement it. */
export function requireContextShiftSupport(load: ClusterEffectiveLoad, startupLog: string): void {
  if (
    load.preferences &&
    load.preferences.overflow !== 'stop' &&
    /(?:ctx_shift|KV cache shifting) is not supported/u.test(startupLog)
  )
    throw Error('UNSUPPORTED_SETTING');
}
