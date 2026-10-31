import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

interface Observation {
  readonly pid: number;
  readonly exitCode: number;
  readonly activeProcesses: number;
  readonly output: string;
  /** Sum of the captured helper/server peak resident sets; -1 means observation failed. */
  readonly peakWorkingSet: number;
  /** Peak private commit of the complete owned engine job, in bytes. */
  readonly peakJobCommit: number;
}
interface Binding {
  /** Private one-use engine credential; only a captured server in this deployment may read it. */
  createCredential(root: object, nonce: string, secret: string): object;
  credentialPath(credential: object): string;
  /** Non-blocking connect/write polling; no byte is sent before retained server identity matches. */
  deliverCredential(credential: object, child: object): boolean;
  /** Cancels pending I/O and clears the native buffer; safe before readiness or after owner loss. */
  releaseCredential(credential: object): void;
  privateDirectory(directory: string): void;
  sealFiles(files: readonly string[]): object;
  releaseFiles(files: object): void;
  captureServer(child: object, pid: number, expectedImage: string): void;
  ownedListener(child: object, port: number): boolean;
  availableMemory(): number;
  systemDirectory(): string;
  programDirectory(): string;
  createDeployment(): object;
  admitCore(root: object, pid: number, image: string, launchTime: number): void;
  launch(root: object, executable: string, args: readonly string[]): object;
  launchConsole(
    root: object,
    executable: string,
    args: readonly string[],
    temporaryDirectory: string,
  ): object;
  /** GPU visibility is set only in this owned child, using a full physical UUID. */
  launchCudaConsole(
    root: object,
    executable: string,
    args: readonly string[],
    temporaryDirectory: string,
    gpuUuid: string,
  ): object;
  /** Ordered target/proposer visibility for a bounded three-device process. */
  launchCudaPlanConsole(
    root: object,
    executable: string,
    args: readonly string[],
    temporaryDirectory: string,
    orderedUuids: readonly string[],
  ): object;
  observe(child: object): Observation;
  requestStop(child: object): void;
  abortFixture(child: object): void;
  forceStop(child: object): void;
  release(child: object): void;
  closeDeployment(root: object): void;
  coresExited(root: object): boolean;
}
const operations = [
  'createCredential',
  'credentialPath',
  'deliverCredential',
  'releaseCredential',
  'privateDirectory',
  'sealFiles',
  'releaseFiles',
  'captureServer',
  'ownedListener',
  'availableMemory',
  'systemDirectory',
  'programDirectory',
  'createDeployment',
  'admitCore',
  'launch',
  'launchConsole',
  'launchCudaConsole',
  'launchCudaPlanConsole',
  'observe',
  'requestStop',
  'abortFixture',
  'forceStop',
  'release',
  'closeDeployment',
  'coresExited',
] as const;

/** Loads only the local development fixture binding; never resolves a renderer-supplied path. */
export function ownershipBinding(): Binding {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('UNSUPPORTED_PLATFORM');
  const loaded: unknown = createRequire(import.meta.url)(
    fileURLToPath(new URL('../../out/native/ownership.node', import.meta.url)),
  );
  if (
    !loaded ||
    typeof loaded !== 'object' ||
    !operations.every((key) => key in loaded && typeof Reflect.get(loaded, key) === 'function')
  )
    throw new Error('INVALID_NATIVE_BINDING');
  // The private native module's complete operation table is checked before this narrow assertion.
  return loaded as Binding;
}

/** Bounded ownership-only wait. Job completion, not a successful termination call, is required. */
export async function confirmExit(done: () => boolean, milliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!done()) {
    if (Date.now() >= deadline) throw new Error('CLEANUP_FAILED');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
