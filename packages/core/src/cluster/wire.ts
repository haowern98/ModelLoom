import {
  decodeCapturedClusterLoad,
  decodeClusterDraft,
  decodeClusterEdit,
  decodeSavedClusterConfiguration,
  decodeConfigurationName,
} from './contracts.js';
import type {
  AssignmentIssue,
  CapturedClusterLoad,
  ClusterDraft,
  ClusterEdit,
  SavedClusterConfiguration,
} from './contracts.js';
export type ClusterCommand =
  | { action: 'delete'; id: string; revision: number }
  | { action: 'list' }
  | { action: 'read'; modelId: string; configurationId: string | null }
  | { action: 'edit'; key: string; expectedRevision: number | null; edit: ClusterEdit }
  | { action: 'save'; key: string; revision: number; name: string | null }
  | { action: 'discard'; key: string; revision: number }
  | { action: 'auto-place'; key: string; revision: number }
  | { action: 'cancel-planning' };
const errors = [
  'NOT_READY',
  'INVALID_CONTROL',
  'INVALID_CLUSTER_CONFIGURATION',
  'UNKNOWN_MODEL',
  'UNKNOWN_CONFIGURATION',
  'STALE_CONFIGURATION',
  'CONFIGURATION_UNAVAILABLE',
  'NEEDS_MODEL_METADATA',
  'NEEDS_RESOURCE_EVIDENCE',
  'UNREPRESENTABLE_CLUSTER_PLACEMENT',
  'PLANNING_CANCELLED',
  'PLANNING_INCOMPLETE',
  'INSUFFICIENT_RESOURCES',
  'INCOMPATIBLE_DRIVER',
  'CLEANUP_FAILED',
] as const;
export type ClusterError = (typeof errors)[number];
export type ClusterReply =
  | { readonly ok: false; readonly error: ClusterError }
  | {
      readonly ok: true;
      readonly configurations: readonly SavedClusterConfiguration[];
      readonly configuration: SavedClusterConfiguration | null;
      readonly draft: ClusterDraft | null;
      readonly load: CapturedClusterLoad | null;
      readonly issues: readonly AssignmentIssue[];
    };
export interface ClusterBridge {
  command(input: ClusterCommand): Promise<ClusterReply>;
}
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function fail(): never {
  throw Error('INVALID_CONTROL');
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const v = input as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k)))
    return fail();
  return v;
}
function revision(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v >= Number.MAX_SAFE_INTEGER)
    return fail();
  return v;
}
function key(v: unknown): string {
  if (
    typeof v !== 'string' ||
    (!/^model:[a-f0-9]{64}$/u.test(v) && !(v.startsWith('config:') && id.test(v.slice(7))))
  )
    return fail();
  return v;
}
function bounded<T>(input: unknown, work: () => T): T {
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 131072) return fail();
    return work();
  } catch {
    return fail();
  }
}
export function decodeClusterCommand(input: unknown): ClusterCommand {
  return bounded(input, () => {
    const a: unknown =
      input && typeof input === 'object' ? Reflect.get(input, 'action') : undefined;
    if (a === 'list' || a === 'cancel-planning') {
      object(input, ['action']);
      return { action: a };
    }
    if (a === 'read') {
      const v = object(input, ['action', 'modelId', 'configurationId']);
      if (
        typeof v.modelId !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(v.modelId) ||
        (v.configurationId !== null &&
          (typeof v.configurationId !== 'string' || !id.test(v.configurationId)))
      )
        return fail();
      return { action: a, modelId: v.modelId, configurationId: v.configurationId };
    }
    if (a === 'delete') {
      const v = object(input, ['action', 'id', 'revision']);
      if (typeof v.id !== 'string' || !id.test(v.id)) return fail();
      return { action: a, id: v.id, revision: revision(v.revision) };
    }
    if (a === 'edit') {
      const v = object(input, ['action', 'key', 'expectedRevision', 'edit']);
      return {
        action: a,
        key: key(v.key),
        expectedRevision: v.expectedRevision === null ? null : revision(v.expectedRevision),
        edit: decodeClusterEdit(v.edit),
      };
    }
    if (a === 'save') {
      const v = object(input, ['action', 'key', 'revision', 'name']);
      return {
        action: a,
        key: key(v.key),
        revision: revision(v.revision),
        name: v.name === null ? null : decodeConfigurationName(v.name),
      };
    }
    if (a === 'discard' || a === 'auto-place') {
      const v = object(input, ['action', 'key', 'revision']);
      return { action: a, key: key(v.key), revision: revision(v.revision) };
    }
    return fail();
  });
}
export function decodeClusterReply(input: unknown): ClusterReply {
  return bounded(input, () => {
    const ok = input && typeof input === 'object' && Reflect.get(input, 'ok') === true;
    const v = object(
      input,
      ok ? ['ok', 'configurations', 'configuration', 'draft', 'load', 'issues'] : ['ok', 'error'],
    );
    if (!ok) {
      if (v.ok !== false) return fail();
      for (const error of errors) if (v.error === error) return { ok: false, error };
      return fail();
    }
    if (
      !Array.isArray(v.configurations) ||
      v.configurations.length > 128 ||
      !Array.isArray(v.issues) ||
      v.issues.length > 16
    )
      return fail();
    const issues: AssignmentIssue[] = v.issues.map((input: unknown) => {
      const i = object(input, ['uuid', 'field', 'code']);
      if (
        (i.uuid !== null &&
          (typeof i.uuid !== 'string' ||
            !/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(i.uuid))) ||
        !['first', 'last', 'coverage', 'load'].includes(String(i.field)) ||
        ![
          'invalid-integer',
          'out-of-bounds',
          'reversed',
          'coverage',
          'unsupported-block-count',
          'invalid-load',
          'invalid-runs',
        ].includes(String(i.code))
      )
        return fail();
      return {
        uuid: i.uuid,
        field: i.field as AssignmentIssue['field'],
        code: i.code as AssignmentIssue['code'],
      };
    });
    return {
      ok: true,
      configurations: v.configurations.map(decodeSavedClusterConfiguration),
      configuration:
        v.configuration === null ? null : decodeSavedClusterConfiguration(v.configuration),
      draft: v.draft === null ? null : decodeClusterDraft(v.draft),
      load: v.load === null ? null : decodeCapturedClusterLoad(v.load),
      issues,
    };
  });
}
