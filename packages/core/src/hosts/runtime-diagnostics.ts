import { open } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { RUNTIME_LOG_LIMITS, runtimeLogSources } from './runtime-log-contracts.js';
import type {
  RuntimeLogEntry,
  RuntimeLogSnapshot,
  RuntimeLogSource,
} from './runtime-log-contracts.js';

export type RuntimeDiagnostic = (source: RuntimeLogSource, message: string) => void;
export function emitRuntimeDiagnostic(source: RuntimeLogSource, message: string): void {
  try {
    console.error(`[ModelLoom][${source}] ${clean(message)}`);
  } catch {
    /* Logs cannot interrupt execution. */
  }
}
const clean = (text: string) =>
  stripVTControlCharacters(text)
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 4096);

/** Main owns the single terminal/file sink; diagnostic failures never affect inference. */
export function createRuntimeLog(
  directory: string,
  terminal: (text: string) => void = (text) => {
    console.error(text.trimEnd());
  },
) {
  let lines: string[] = [],
    bytes = 0,
    pending: Promise<void> | undefined;
  let history: RuntimeLogEntry[] = [],
    historyBytes = 0,
    revision = 0;
  async function save() {
    while (true) {
      const snapshot = lines;
      lines = [];
      bytes = 0;
      try {
        const file = await open(path.join(directory, 'runtime.log'), 'a');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1) throw Error('INVALID_LOG_FILE');
          // Keep the same file handle valid for Get-Content -Wait, including bounded rollover.
          if (stat.size + Buffer.byteLength(snapshot.join('')) > 524288) await file.truncate(0);
          await file.writeFile(snapshot.join(''));
        } finally {
          await file.close();
        }
      } catch {
        // A diagnostic write must not change admission, execution or cleanup.
      }
      if (!lines.length) {
        pending = undefined;
        return;
      }
    }
  }
  const write: RuntimeDiagnostic = (source, message) => {
    const at = new Date().toISOString();
    message = clean(message);
    const exit = /(?:native|helper|utility)\.exit code=(-?\d+)/u.exec(message);
    const level = (
      exit
        ? Number(exit[1]) !== 0 || message.includes('stopping=false')
        : /(?:GGML_ASSERT|CUDA error|\b(?:error|fatal|failed|failure)\b|\.failed\b|_(?:FAILED|UNAVAILABLE|EXPIRED)|"decision":"(?:retry|disconnect)"|stream-lost|force-stop reason=)/iu.test(
            message,
          )
    )
      ? 'error'
      : 'info';
    const entry = Object.freeze({ id: ++revision, at, source, level, message });
    history.push(entry);
    historyBytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
    while (
      history.length > RUNTIME_LOG_LIMITS.entries ||
      historyBytes + 2 > RUNTIME_LOG_LIMITS.bytes
    )
      historyBytes -= Buffer.byteLength(JSON.stringify(history.shift()!)) + 1;
    const line = `${at} [ModelLoom][${source}] ${message}\n`;
    try {
      terminal(line);
    } catch {
      /* A closed terminal must not interrupt inference. */
    }
    lines = [...lines, line];
    bytes += Buffer.byteLength(line);
    while (bytes > 524288 || lines.length > 2048) bytes -= Buffer.byteLength(lines.shift()!);
    pending ??= Promise.resolve().then(save);
  };
  return {
    write,
    read(after?: number): RuntimeLogSnapshot {
      return Object.freeze({
        ok: true,
        revision,
        entries: after === revision ? null : Object.freeze([...history]),
      });
    },
    clear() {
      history = [];
      historyBytes = 0;
      revision++;
    },
    flush: () => pending ?? Promise.resolve(),
  };
}

/** Utility stdout is not a logging/control protocol. Forward only owned diagnostic prefixes. */
export function forwardUtilityDiagnostics(
  child: { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null },
  log: RuntimeDiagnostic,
): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    stream.setEncoding('utf8');
    let partial = '',
      dropping = false;
    const consume = (line: string) => {
      const match = /^\[ModelLoom\]\[([a-z]+)\] (.*)$/u.exec(line);
      const source = runtimeLogSources.find((source) => source === match?.[1]);
      if (match && source) log(source, match[2]!);
      else if (/^(?:\[ModelLoom\]|RPC owned startup:)/u.test(line)) log('core', line);
    };
    stream.on('data', (text: string) => {
      for (const part of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
        const complete = part.endsWith('\n');
        if (!dropping) partial += part;
        if (partial.length > 8192) {
          partial = '';
          dropping = true;
        }
        if (complete) {
          if (!dropping) consume(partial.trimEnd());
          partial = '';
          dropping = false;
        }
      }
    });
    stream.on('end', () => {
      if (!dropping) consume(partial);
      partial = '';
    });
    stream.on('error', () => {
      partial = '';
    });
  }
}

/** Only native load/error diagnostics are emitted; prompts and generated tokens are excluded. */
export function nativeRuntimeDiagnostics(log: RuntimeDiagnostic, secrets: readonly string[]) {
  let partial = '',
    isReady = false;
  function consume(line: string) {
    line = clean(line).trimStart();
    const fatal =
      /^(?:[^\r\n]*\.(?:cpp|cc|cu):\d+: )?(?:GGML_ASSERT|CUDA error|CUDA_ERROR|(?:ggml|llama)_\w+:.*(?:error|failed|assert)|error loading model|(?:error|fatal):)/iu.test(
        line,
      );
    const loading =
      /^(?:load_tensors|llama_model_loader|llama_model_load(?:_from_file_impl)?|llama_context|llama_kv_cache|llama_memory|common_init_from_params|common_speculative_init_result|ggml_backend_cuda|ggml_cuda_init|ggml_backend_rpc):/u.test(
        line,
      );
    if (!fatal && (isReady || !loading)) return;
    for (const secret of secrets) if (secret) line = line.replaceAll(secret, '[redacted]');
    log('runtime', clean(line));
  }
  return {
    push(text: string, ready = false) {
      isReady = ready;
      const lines = (partial + text).split('\n');
      partial = lines.pop()!.slice(-4096);
      for (const line of lines) consume(line.slice(0, 4096));
    },
    flush() {
      if (partial) consume(partial);
      partial = '';
    },
  };
}
