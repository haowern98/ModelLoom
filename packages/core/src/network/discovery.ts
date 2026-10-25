import { randomUUID } from 'node:crypto';
import type { TailnetPeer } from './helper.js';
import type { NetworkCandidate } from './wire.js';

/** Capability probing is read-only and deliberately separate from pairing introduction. */
export class TailnetDiscovery {
  private generation = 0;
  private readonly candidates = new Map<string, NetworkCandidate>();
  private readonly checked = new Map<string, number>();
  private peers = new Map<string, TailnetPeer>();
  private running: Promise<void> | undefined;
  private controller = new AbortController();
  constructor(
    private readonly probe: (address: string, signal: AbortSignal) => Promise<unknown>,
    private readonly changed: () => void,
    private readonly now = () => Date.now(),
  ) {}
  view(): readonly NetworkCandidate[] {
    const identities = new Map<string, NetworkCandidate>();
    for (const candidate of this.candidates.values())
      if (!identities.has(candidate.fingerprint)) identities.set(candidate.fingerprint, candidate);
    return [...identities.values()];
  }
  resolve(id: string): NetworkCandidate | undefined {
    return this.view().find((candidate) => candidate.id === id);
  }
  clear(): void {
    ++this.generation;
    this.controller.abort();
    this.controller = new AbortController();
    this.peers.clear();
    this.candidates.clear();
    this.checked.clear();
    this.changed();
  }
  update(peers: readonly TailnetPeer[]): Promise<void> {
    this.peers = new Map(peers.filter((peer) => peer.online).map((peer) => [peer.address, peer]));
    for (const address of this.candidates.keys())
      if (!this.peers.has(address)) this.candidates.delete(address);
    for (const address of this.checked.keys())
      if (!this.peers.has(address)) this.checked.delete(address);
    this.changed();
    if (this.running) return this.running;
    const generation = this.generation,
      signal = this.controller.signal;
    const run = async () => {
      const busy = new Set<string>();
      const worker = async () => {
        while (generation === this.generation && !signal.aborted) {
          const peer = [...this.peers.values()].find(
            (peer) =>
              !busy.has(peer.address) &&
              this.now() - (this.checked.get(peer.address) ?? -Infinity) >= 60000,
          );
          if (!peer) return;
          busy.add(peer.address);
          this.checked.set(peer.address, this.now());
          const timeout = new AbortController(),
            timer = setTimeout(() => timeout.abort(), 3000);
          try {
            const input = await this.probe(peer.address, AbortSignal.any([signal, timeout.signal]));
            if (
              generation !== this.generation ||
              signal.aborted ||
              timeout.signal.aborted ||
              !this.peers.has(peer.address)
            )
              continue;
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).sort().join(',') !== 'fingerprint,name,protocol,sharing'
            )
              throw Error('INVALID_DISCOVERY');
            const value = input as Record<string, unknown>;
            if (
              value.protocol !== 1 ||
              value.sharing !== true ||
              typeof value.fingerprint !== 'string' ||
              !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
              typeof value.name !== 'string' ||
              !value.name.length ||
              value.name.length > 80 ||
              [...value.name].some(
                (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
              )
            )
              throw Error('INVALID_DISCOVERY');
            const previous = this.candidates.get(peer.address);
            this.candidates.set(peer.address, {
              id: previous?.fingerprint === value.fingerprint ? previous.id : randomUUID(),
              name: value.name,
              address: peer.address,
              fingerprint: value.fingerprint,
            });
          } catch {
            if (generation === this.generation) this.candidates.delete(peer.address);
          } finally {
            clearTimeout(timer);
            busy.delete(peer.address);
            if (generation === this.generation) this.changed();
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    };
    this.running = run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
}
