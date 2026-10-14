import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Replace a complete harness record; another process must never read a partially written JSON file. */
export function writeHarnessFile(file: string, text: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

interface ClientState {
  kind?: string;
  status?: number;
  count?: number;
  statuses?: number[];
  usage?: { completion_tokens: number };
  streamStarted?: boolean;
  events?: number;
  done?: boolean;
  reasoningChars?: number;
  stableIds?: boolean;
  aborted?: boolean;
  burstStarted?: number;
  burstEnded?: unknown[];
}

/** Validate the local harness response before assertions use it as evidence. */
export function readClientState(file: string): ClientState {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_CLIENT_STATE');
  const fields = value as Record<string, unknown>;
  for (const name of ['status', 'count', 'events', 'reasoningChars', 'burstStarted']) {
    if (fields[name] !== undefined && typeof fields[name] !== 'number')
      throw new Error('INVALID_CLIENT_STATE');
  }
  for (const name of ['streamStarted', 'done', 'stableIds', 'aborted']) {
    if (fields[name] !== undefined && typeof fields[name] !== 'boolean')
      throw new Error('INVALID_CLIENT_STATE');
  }
  if (fields.kind !== undefined && typeof fields.kind !== 'string')
    throw new Error('INVALID_CLIENT_STATE');
  if (
    fields.statuses !== undefined &&
    (!Array.isArray(fields.statuses) ||
      fields.statuses.some((status: unknown) => typeof status !== 'number'))
  )
    throw new Error('INVALID_CLIENT_STATE');
  if (fields.burstEnded !== undefined && !Array.isArray(fields.burstEnded))
    throw new Error('INVALID_CLIENT_STATE');
  if (
    fields.usage !== undefined &&
    (!fields.usage ||
      typeof fields.usage !== 'object' ||
      !('completion_tokens' in fields.usage) ||
      typeof fields.usage.completion_tokens !== 'number')
  )
    throw new Error('INVALID_CLIENT_STATE');
  return value;
}
