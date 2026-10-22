/** In-process ownership handle. Copies and serialized values cannot release an assignment. */
export interface GpuReservation {
  readonly kind: 'local' | 'remote';
  readonly peerIdentity: string | null;
  readonly gpuUuids: readonly string[];
}
interface Entry {
  readonly reservation: GpuReservation;
  state: 'active' | 'releasing';
  expiresAt: number | null;
}
const gpuPattern = /^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
function invalid(): never {
  throw new Error('INVALID_GPU_RESERVATION');
}

/** Core-owned GPU arbitration, not peer authentication or native launch authority.
 * The caller must authenticate/authorize remote peers before acquiring hardware.
 * Poll pendingRelease and confirm teardown before hardware can be reused. */
export class GpuReservations {
  private readonly devices = new Map<string, string>();
  private shared: readonly string[] = Object.freeze([]);
  private local: Entry | undefined;
  private remote: Entry | undefined;
  private previousTime = -Infinity;

  constructor(
    devices: readonly string[],
    private readonly leaseMilliseconds: number,
    private readonly now: () => number,
  ) {
    if (
      !Array.isArray(devices) ||
      !Number.isSafeInteger(leaseMilliseconds) ||
      leaseMilliseconds < 1
    )
      invalid();
    for (const uuid of devices) {
      if (
        typeof uuid !== 'string' ||
        !gpuPattern.test(uuid) ||
        this.devices.has(uuid.toLowerCase())
      )
        invalid();
      this.devices.set(uuid.toLowerCase(), uuid);
    }
    this.tick();
  }

  setShared(gpuUuids: readonly string[]): void {
    const selected = this.select(gpuUuids, true);
    this.tick();
    this.shared = selected;
    if (this.remote?.reservation.gpuUuids.some((uuid) => !selected.includes(uuid)))
      this.remote.state = 'releasing';
  }

  /** Hardware removal requests cleanup but retains the exact owned release handle. */
  updateDevices(devices: readonly string[]): void {
    const next = new Map<string, string>();
    for (const uuid of devices) {
      if (typeof uuid !== 'string' || !gpuPattern.test(uuid) || next.has(uuid.toLowerCase()))
        invalid();
      next.set(uuid.toLowerCase(), uuid);
    }
    this.tick();
    this.devices.clear();
    for (const [key, value] of next) this.devices.set(key, value);
    this.shared = this.shared.filter((uuid) => next.has(uuid.toLowerCase()));
    for (const entry of [this.local, this.remote]) {
      if (entry?.reservation.gpuUuids.some((uuid) => !next.has(uuid.toLowerCase())))
        entry.state = 'releasing';
    }
  }

  reserveLocal(gpuUuids: readonly string[]): GpuReservation {
    const selected = this.select(gpuUuids);
    this.tick();
    if (this.local || this.overlaps(this.remote, selected)) throw new Error('GPU_BUSY');
    this.local = this.entry('local', null, selected, null);
    return this.local.reservation;
  }

  /** peerIdentity is the verified certificate identity supplied by the trusted peer owner. */
  reserveRemote(peerIdentity: string, gpuUuids: readonly string[]): GpuReservation {
    if (typeof peerIdentity !== 'string' || !/^[a-f0-9]{64}$/u.test(peerIdentity))
      throw new Error('INVALID_PEER_IDENTITY');
    const selected = this.select(gpuUuids);
    const time = this.tick();
    if (selected.some((uuid) => !this.shared.includes(uuid))) throw new Error('GPU_NOT_SHARED');
    if (this.remote || this.overlaps(this.local, selected)) throw new Error('GPU_BUSY');
    this.remote = this.entry('remote', peerIdentity, selected, this.deadline(time));
    return this.remote.reservation;
  }

  renew(reservation: GpuReservation): boolean {
    const time = this.tick();
    if (this.remote?.reservation !== reservation || this.remote.state !== 'active') return false;
    this.remote.expiresAt = this.deadline(time);
    return true;
  }

  /** Stop sharing, revocation, disconnect and Quit all request release through this path. */
  beginRelease(reservation: GpuReservation): boolean {
    this.tick();
    const entry = this.find(reservation);
    if (!entry) return false;
    entry.state = 'releasing';
    return true;
  }

  /** Only the trusted runtime owner calls this after confirmed teardown, including failed loads. */
  confirmReleased(reservation: GpuReservation): boolean {
    this.tick();
    const entry = this.find(reservation);
    if (!entry || entry.state !== 'releasing') return false;
    if (entry === this.local) this.local = undefined;
    else this.remote = undefined;
    return true;
  }

  pendingRelease(): readonly GpuReservation[] {
    this.tick();
    return Object.freeze(
      this.entries()
        .filter((entry) => entry.state === 'releasing')
        .map((entry) => entry.reservation),
    );
  }

  snapshot(): Readonly<{
    shared: readonly string[];
    reservations: readonly Readonly<Entry>[];
  }> {
    this.tick();
    return Object.freeze({
      shared: this.shared,
      reservations: Object.freeze(this.entries().map((entry) => Object.freeze({ ...entry }))),
    });
  }

  private select(gpuUuids: readonly string[], allowEmpty = false): readonly string[] {
    if (!Array.isArray(gpuUuids) || (!allowEmpty && !gpuUuids.length)) return invalid();
    const selected = gpuUuids.map((uuid) => {
      if (typeof uuid !== 'string') return invalid();
      return this.devices.get(uuid.toLowerCase()) ?? invalid();
    });
    if (new Set(selected).size !== selected.length) return invalid();
    return Object.freeze(selected);
  }

  private tick(): number {
    const time = this.now();
    if (!Number.isFinite(time) || time < 0 || time < this.previousTime)
      throw new Error('INVALID_RESERVATION_CLOCK');
    this.previousTime = time;
    if (this.remote?.expiresAt !== null && this.remote && time >= this.remote.expiresAt)
      this.remote.state = 'releasing';
    return time;
  }

  private deadline(time: number): number {
    const deadline = time + this.leaseMilliseconds;
    if (!Number.isFinite(deadline) || deadline <= time)
      throw new Error('INVALID_RESERVATION_CLOCK');
    return deadline;
  }

  private entry(
    kind: GpuReservation['kind'],
    peerIdentity: string | null,
    gpuUuids: readonly string[],
    expiresAt: number | null,
  ): Entry {
    return {
      reservation: Object.freeze({ kind, peerIdentity, gpuUuids }),
      state: 'active',
      expiresAt,
    };
  }

  private entries(): Entry[] {
    return [this.local, this.remote].filter((entry): entry is Entry => entry !== undefined);
  }

  private find(reservation: GpuReservation): Entry | undefined {
    return this.entries().find((entry) => entry.reservation === reservation);
  }

  private overlaps(entry: Entry | undefined, gpuUuids: readonly string[]): boolean {
    return entry?.reservation.gpuUuids.some((uuid) => gpuUuids.includes(uuid)) ?? false;
  }
}
