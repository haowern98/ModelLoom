import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiCallerScope } from '../generation/api-authority.js';
import type { ApiCaller } from '../generation/api-authority.js';
import type { ApiKeyProtection } from '../model-configuration/windows-protection.js';
import type { ProtectedApiCredential } from '../model-configuration/store.js';
export interface ApiCredentialRepository {
  readCredential(): Promise<ProtectedApiCredential | null>;
  replaceCredential(
    expectedGeneration: number,
    protectedKey: Buffer,
  ): Promise<ProtectedApiCredential>;
}
function unavailable(): never {
  throw new Error('CREDENTIAL_UNAVAILABLE');
}
function keyBytes(input: Buffer): Buffer {
  if (
    !Buffer.isBuffer(input) ||
    input.length !== 67 ||
    !/^ml_[a-f0-9]{64}$/u.test(input.toString('utf8'))
  )
    return unavailable();
  return input;
}
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest();
/** Utility-owned recoverable public key. Runtime/signing credentials are never accepted here. */
export class ApiCredentials {
  private key: Buffer | undefined;
  private hash: Buffer | undefined;
  private generation = 0;
  private scope = new ApiCallerScope();
  private closed = false;
  private rotating = false;
  private failed = false;
  private operations: Promise<void> = Promise.resolve();
  private pending = 0;
  private constructor(
    private readonly repository: ApiCredentialRepository,
    private readonly protection: ApiKeyProtection,
    private readonly revoked: () => Promise<void>,
  ) {}
  static async open(
    repository: ApiCredentialRepository,
    protection: ApiKeyProtection,
    revoked: () => Promise<void>,
  ): Promise<ApiCredentials> {
    const owner = new ApiCredentials(repository, protection, revoked);
    try {
      const saved = await repository.readCredential();
      if (saved) {
        if (!Number.isSafeInteger(saved.generation) || saved.generation < 1) return unavailable();
        const key = protection.unprotect(saved.protectedKey);
        try {
          owner.key = Buffer.from(keyBytes(key));
          owner.hash = digest(key);
          owner.generation = saved.generation;
        } finally {
          key.fill(0);
        }
      }
      return owner;
    } catch {
      owner.close();
      return unavailable();
    }
  }
  status(): { readonly present: boolean; readonly generation: number } {
    return Object.freeze({ present: !this.closed && !!this.key, generation: this.generation });
  }
  canServe(): boolean {
    return !this.closed && !this.failed && !this.rotating && !!this.key;
  }
  /** Compare fixed digests using Node's standard constant-time primitive before issuing authority. */
  authenticate(value: string): ApiCaller | null {
    if (
      this.closed ||
      this.rotating ||
      this.failed ||
      !this.hash ||
      typeof value !== 'string' ||
      !/^ml_[a-f0-9]{64}$/u.test(value)
    )
      return null;
    const candidate = digest(value);
    try {
      return timingSafeEqual(candidate, this.hash) ? this.scope.issue() : null;
    } finally {
      candidate.fill(0);
    }
  }
  /** Explicit transient management action; never included in status, logs or examples. */
  reveal(): string {
    if (this.closed || this.rotating || !this.key) return unavailable();
    return this.key.toString('ascii');
  }
  /** Invalidate authenticated calls from the previous listener instance while retaining its key. */
  revokeCallers(): void {
    this.scope.close();
    this.scope = new ApiCallerScope();
    if (this.closed || this.failed) this.scope.close();
  }
  /** Serialize rotations and commit protected bytes before revoking the old generation. */
  generate(): Promise<void> {
    if (this.closed || this.failed || this.pending >= 4)
      return Promise.reject(new Error('CREDENTIAL_UNAVAILABLE'));
    this.pending++;
    const operation = this.operations.then(() => this.rotate());
    this.operations = operation
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return operation;
  }
  private async rotate(): Promise<void> {
    if (this.closed || this.failed) return unavailable();
    this.rotating = true;
    const random = randomBytes(32);
    const key = Buffer.from(`ml_${random.toString('hex')}`);
    random.fill(0);
    try {
      const protectedKey = this.protection.protect(key);
      const recovered = this.protection.unprotect(protectedKey);
      try {
        if (!timingSafeEqual(key, keyBytes(recovered))) return unavailable();
      } finally {
        recovered.fill(0);
      }
      const committed = await this.repository.replaceCredential(this.generation, protectedKey);
      if (committed.generation !== this.generation + 1) return unavailable();
      // Full Quit can race the write. Persistence may complete, but it cannot reopen admission.
      if (this.closed) return unavailable();
      this.scope.close();
      this.key?.fill(0);
      this.hash?.fill(0);
      this.key = Buffer.from(key);
      this.hash = digest(key);
      this.generation = committed.generation;
      this.scope = new ApiCallerScope();
      try {
        await this.revoked();
      } catch {
        this.failed = true;
        this.scope.close();
        return unavailable();
      }
    } catch {
      return unavailable();
    } finally {
      key.fill(0);
      this.rotating = false;
    }
  }
  close(): void {
    this.closed = true;
    this.scope.close();
    this.key?.fill(0);
    this.hash?.fill(0);
    this.key = undefined;
    this.hash = undefined;
  }
  async join(): Promise<void> {
    await this.operations;
  }
}
