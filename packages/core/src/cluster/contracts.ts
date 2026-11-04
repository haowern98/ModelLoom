import { decodeSpeculativeDefaults } from '../speculative-decoding/contracts.js';
import type { SpeculativeDefaults } from '../speculative-decoding/contracts.js';
import { decodeAdvancedPreferences } from '../model-configuration/contracts.js';
import type { LoadDefaults, AdvancedPreferences } from '../model-configuration/contracts.js';
import { decodeClusterCanvasLayout } from './canvas-layout.js';
import type { ClusterCanvasLayout } from './canvas-layout.js';

/** Same bounded device set accepted by the cluster planning command. */
export const MAX_CLUSTER_GPUS = 16;

export interface RawGpuRun {
  readonly uuid: string;
  readonly first: string;
  readonly last: string;
}
export interface GpuRun {
  readonly uuid: string;
  readonly first: number;
  readonly last: number;
}
export interface CapturedClusterLoad {
  readonly defaults: LoadDefaults;
  readonly speculation?: SpeculativeDefaults;
  readonly preferences?: AdvancedPreferences;
  readonly cacheK: 'f16' | 'q8_0';
  readonly cacheV: 'f16' | 'q8_0';
}
/** Trusted controller identities, separate from editable caller data. */
export interface ClusterDraft {
  readonly canvas?: ClusterCanvasLayout;
  readonly proposerDevice?: string;
  readonly key: string;
  readonly configurationId: string | null;
  readonly modelId: string;
  readonly revision: number;
  readonly baseSavedRevision: number | null;
  readonly load: CapturedClusterLoad;
  readonly runs: readonly RawGpuRun[];
}
export type ClusterEdit = Pick<
  ClusterDraft,
  'modelId' | 'load' | 'runs' | 'canvas' | 'proposerDevice'
>;
export interface SavedClusterConfiguration {
  readonly canvas?: ClusterCanvasLayout;
  readonly proposerDevice?: string;
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly modelId: string;
  readonly blockCount: number;
  readonly profileId: string;
  /** Current model settings resolved by the owner; excluded from named placement storage. */
  readonly load: CapturedClusterLoad;
  readonly runs: readonly GpuRun[];
}
export type AssignmentIssueCode =
  | 'invalid-integer'
  | 'out-of-bounds'
  | 'reversed'
  | 'coverage'
  | 'unsupported-block-count'
  | 'invalid-load'
  | 'invalid-runs';
export type AssignmentIssue = Readonly<{
  uuid: string | null;
  field: 'first' | 'last' | 'coverage' | 'load';
  code: AssignmentIssueCode;
}>;
export type PlacementValidation =
  | Readonly<{ ok: true; runs: readonly GpuRun[] }>
  | Readonly<{ ok: false; issues: readonly AssignmentIssue[] }>;
export interface CompiledPlacement {
  readonly orderedUuids: readonly string[];
  readonly tensorSplit: readonly number[];
  readonly outputUuid: string;
}

function invalid(): never {
  throw new Error('INVALID_CLUSTER_CONFIGURATION');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value;
}
function integer(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max)
    return invalid();
  return input;
}
function text(input: unknown, max: number): string {
  if (
    typeof input !== 'string' ||
    new TextEncoder().encode(input).length > max ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)
  )
    return invalid();
  return input;
}
function match(input: unknown, pattern: RegExp): string {
  return typeof input === 'string' && pattern.test(input) ? input : invalid();
}
function bool(input: unknown): boolean {
  return typeof input === 'boolean' ? input : invalid();
}
const gpu = /^(?:peer:[a-f0-9]{64}:)?GPU-[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/u;
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const model = /^[a-f0-9]{64}$/u;
/** Exact syntax only; native resource and launch validation happen elsewhere. */
export function decodeCapturedClusterLoad(input: unknown): CapturedClusterLoad {
  const v = object(input, [
    'defaults',
    'cacheK',
    'cacheV',
    ...(input && typeof input === 'object' && Object.hasOwn(input, 'speculation')
      ? ['speculation']
      : []),
    ...(input && typeof input === 'object' && Object.hasOwn(input, 'preferences')
      ? ['preferences']
      : []),
  ]);
  const d = object(v.defaults, [
    'automatic',
    'contextLength',
    'threads',
    'evaluationBatch',
    'physicalBatch',
    'concurrency',
    'flashAttention',
  ]);
  const defaults = Object.freeze({
    automatic: bool(d.automatic),
    contextLength: integer(d.contextLength, 1, 2147483647),
    threads: d.threads === null ? null : integer(d.threads, 1, 1024),
    evaluationBatch: integer(d.evaluationBatch, 1, 2147483647),
    physicalBatch: integer(d.physicalBatch, 1, 2147483647),
    concurrency: integer(d.concurrency, 1, 1024),
    flashAttention: bool(d.flashAttention),
  });
  if (defaults.physicalBatch > defaults.evaluationBatch) return invalid();
  return Object.freeze({
    defaults,
    ...(Object.hasOwn(v, 'speculation')
      ? { speculation: decodeSpeculativeDefaults(v.speculation) }
      : {}),
    ...(v.preferences === undefined
      ? {}
      : { preferences: decodeAdvancedPreferences(v.preferences) }),
    cacheK: match(v.cacheK, /^(f16|q8_0)$/u) as 'f16' | 'q8_0',
    cacheV: match(v.cacheV, /^(f16|q8_0)$/u) as 'f16' | 'q8_0',
  });
}
function rawRuns(input: unknown): readonly RawGpuRun[] {
  if (!Array.isArray(input) || input.length > MAX_CLUSTER_GPUS) return invalid();
  const result = input.map((item: unknown) => {
    const v = object(item, ['uuid', 'first', 'last']);
    return Object.freeze({
      uuid: match(v.uuid, gpu),
      first: text(v.first, 64),
      last: text(v.last, 64),
    });
  });
  if (new Set(result.map((r) => r.uuid.toLowerCase())).size !== result.length) return invalid();
  return Object.freeze(result);
}
/** Caller edits cannot choose identities, revisions, profiles, paths or arguments. */
export function decodeClusterEdit(input: unknown): ClusterEdit {
  const v = object(input, [
    'modelId',
    'load',
    'runs',
    ...canvasKeys(input),
    ...proposerKeys(input),
  ]);
  return Object.freeze({
    ...canvasValue(v),
    ...proposerValue(v),
    modelId: match(v.modelId, model),
    load: decodeCapturedClusterLoad(v.load),
    runs: rawRuns(v.runs),
  });
}
export function decodeClusterDraft(input: unknown): ClusterDraft {
  const v = object(input, [
    'key',
    'configurationId',
    'modelId',
    'revision',
    'baseSavedRevision',
    'load',
    'runs',
    ...canvasKeys(input),
    ...proposerKeys(input),
  ]);
  const key = text(v.key, 160);
  if (!key || Array.from(key).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    return invalid();
  return Object.freeze({
    ...canvasValue(v),
    ...proposerValue(v),
    key,
    configurationId: v.configurationId === null ? null : match(v.configurationId, id),
    modelId: match(v.modelId, model),
    revision: integer(v.revision),
    baseSavedRevision: v.baseSavedRevision === null ? null : integer(v.baseSavedRevision),
    load: decodeCapturedClusterLoad(v.load),
    runs: rawRuns(v.runs),
  });
}
export function decodeConfigurationName(input: unknown): string {
  const result = text(input, 128);
  return result.trim().length &&
    !Array.from(result).some(
      (c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
    )
    ? result
    : invalid();
}
/** Decode internal persisted syntax without treating it as activation authority. */
export function decodeSavedClusterConfiguration(input: unknown): SavedClusterConfiguration {
  const v = object(input, [
    'id',
    'name',
    'revision',
    'modelId',
    'blockCount',
    'profileId',
    'load',
    'runs',
    ...canvasKeys(input),
    ...proposerKeys(input),
  ]);
  if (!Array.isArray(v.runs) || v.runs.length < 1 || v.runs.length > MAX_CLUSTER_GPUS)
    return invalid();
  const blockCount = integer(v.blockCount, 1, 2147483647);
  const runs = v.runs.map((item: unknown) => {
    const r = object(item, ['uuid', 'first', 'last']);
    return Object.freeze({
      uuid: match(r.uuid, gpu),
      first: integer(r.first, 0, blockCount - 1),
      last: integer(r.last, 0, blockCount - 1),
    });
  });
  const ordered = [...runs].sort((a, b) => a.first - b.first);
  if (
    new Set(runs.map((r) => r.uuid.toLowerCase())).size !== runs.length ||
    ordered[0]?.first !== 0 ||
    ordered.at(-1)?.last !== blockCount - 1 ||
    ordered.some((r, i) => r.first > r.last || (i > 0 && r.first !== ordered[i - 1]!.last + 1))
  )
    return invalid();
  return Object.freeze({
    ...canvasValue(v),
    ...proposerValue(v),
    id: match(v.id, id),
    name: decodeConfigurationName(v.name),
    revision: integer(v.revision),
    modelId: match(v.modelId, model),
    blockCount,
    profileId: match(v.profileId, /^[A-Za-z0-9_-]{1,128}$/u),
    load: decodeCapturedClusterLoad(v.load),
    runs: Object.freeze(runs),
  });
}

function canvasKeys(input: unknown): string[] {
  return input && typeof input === 'object' && Object.hasOwn(input, 'canvas') ? ['canvas'] : [];
}
function canvasValue(value: Record<string, unknown>): { canvas?: ClusterCanvasLayout } {
  return value.canvas === undefined ? {} : { canvas: decodeClusterCanvasLayout(value.canvas) };
}

function proposerKeys(input: unknown): string[] {
  return input && typeof input === 'object' && Object.hasOwn(input, 'proposerDevice')
    ? ['proposerDevice']
    : [];
}
function proposerValue(value: Record<string, unknown>): { proposerDevice?: string } {
  if (!Object.hasOwn(value, 'proposerDevice')) return {};
  const device = value.proposerDevice;
  return { proposerDevice: device === 'auto' || device === 'cpu' ? device : match(device, gpu) };
}
