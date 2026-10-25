import type { Duplex } from 'node:stream';
import type { HelperEvents, TailnetPeer } from './helper.js';
import { TailnetDiscovery } from './discovery.js';
import { decodeNetworkCommand, decodeNetworkReply, validateLoginUrl } from './wire.js';
import type { NetworkCommand, NetworkReply, NetworkView } from './wire.js';

export interface NetworkComponent {
  command(
    action: 'connect' | 'disconnect' | 'sign-out' | 'status' | 'listen' | 'unlisten',
  ): Promise<void>;
  dial(address: string, port: number, signal?: AbortSignal): Promise<Duplex>;
  close(): Promise<void>;
}
interface Dependencies {
  open(events: HelperEvents): Promise<NetworkComponent>;
  openLogin(url: string): Promise<void>;
  probe(address: string, signal: AbortSignal): Promise<unknown>;
  rememberEnabled?(enabled: boolean): Promise<void>;
  forgetEnrollment?(): Promise<void>;
}
const empty = (): NetworkView => ({ state: 'disconnected', addresses: [], candidates: [] });

/** Transport/enrollment owner; native worker authorization is an independent consumer. */
export class NetworkOwner {
  private view: NetworkView = empty();
  private generation = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private component: NetworkComponent | undefined;
  private login: string | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly discovery: TailnetDiscovery;
  private peers: readonly TailnetPeer[] = [];
  private incoming: ((port: number, stream: Duplex) => void) | undefined;
  private sharing = false;
  private fingerprint: string | undefined;
  private cleanup = Promise.resolve();
  private readonly pendingCleanup = new Set<NetworkComponent>();
  private mutations = Promise.resolve();
  constructor(private readonly deps: Dependencies) {
    this.discovery = new TailnetDiscovery(
      (address, signal) => deps.probe(address, signal),
      () => this.emit(),
    );
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  snapshot(): NetworkView {
    return {
      ...this.view,
      candidates: this.discovery
        .view()
        .filter((candidate) => candidate.fingerprint !== this.fingerprint),
    };
  }
  routes(): readonly string[] {
    return this.view.state === 'connected' ? this.peers.map((peer) => peer.address) : [];
  }
  setIncoming(listener: (port: number, stream: Duplex) => void): () => void {
    this.incoming = listener;
    return () => {
      if (this.incoming === listener) this.incoming = undefined;
    };
  }
  async setSharing(sharing: boolean, fingerprint?: string): Promise<void> {
    this.sharing = sharing;
    this.fingerprint = fingerprint;
    if (this.component && this.view.state === 'connected')
      await this.component.command(sharing ? 'listen' : 'unlisten');
  }
  resolveCandidate(id: string) {
    return this.discovery.resolve(id);
  }
  dial(address: string, port: number, signal?: AbortSignal): Promise<Duplex> {
    if (
      !this.component ||
      this.view.state !== 'connected' ||
      !this.peers.some((peer) => peer.address === address)
    )
      return Promise.reject(Error('NETWORK_ROUTE_UNAVAILABLE'));
    return this.component.dial(address, port, signal);
  }
  private async start(): Promise<void> {
    if (this.component || this.closed) return;
    const generation = ++this.generation;
    this.view = { state: 'starting', addresses: [], candidates: [] };
    this.emit();
    try {
      const current = () => !this.closed && generation === this.generation;
      const component = await this.deps.open({
        status: (view, peers) => {
          if (!current()) return;
          const changedNetwork =
            this.view.tailnet !== undefined && view.tailnet !== this.view.tailnet;
          if (changedNetwork || view.state !== 'connected') this.discovery.clear();
          const previouslyConnected = this.view.state === 'connected';
          this.view = view;
          this.peers = peers;
          if (view.state === 'connected') {
            this.login = undefined;
            void this.discovery.update(peers).catch(() => undefined);
            if (!previouslyConnected && this.sharing)
              void this.component?.command('listen').catch(() => this.fail('NETWORK_UNAVAILABLE'));
          }
          this.emit();
        },
        login: (url) => {
          if (!current()) return;
          this.login = validateLoginUrl(url);
          this.view = { ...this.view, state: 'needs-login' };
          this.emit();
          void this.deps.openLogin(this.login).catch(() => {
            if (current()) this.fail('NETWORK_LOGIN_FAILED');
          });
        },
        incoming: (port, stream) => {
          if (current() && this.view.state === 'connected' && this.sharing && this.incoming)
            this.incoming(port, stream);
          else stream.destroy();
        },
        lost: () => {
          if (current()) this.fail('NETWORK_COMPONENT_FAILED');
        },
      });
      if (!current()) {
        await component.close();
        return;
      }
      this.component = component;
      await this.deps.rememberEnabled?.(true);
      if (current()) await component.command('connect');
    } catch (error) {
      if (generation === this.generation && !this.closed)
        this.fail(
          error instanceof Error && /^NETWORK_[A-Z_]+$/u.test(error.message)
            ? error.message
            : 'NETWORK_UNAVAILABLE',
        );
    }
  }
  private fail(error: string): void {
    ++this.generation;
    const component = this.component;
    this.component = undefined;
    if (component) void this.queueCleanup(component).catch(() => undefined);
    // Retain cleanup failure for the next command/quit while avoiding an
    // unhandled rejection from an asynchronous helper notification.
    void this.cleanup.catch(() => undefined);
    this.login = undefined;
    this.peers = [];
    this.discovery.clear();
    this.view = { state: 'failed', addresses: [], candidates: [], error };
    this.emit();
  }
  private queueCleanup(component?: NetworkComponent): Promise<void> {
    if (component) this.pendingCleanup.add(component);
    this.cleanup = this.cleanup
      .catch(() => undefined)
      .then(async () => {
        for (const pending of this.pendingCleanup) {
          await pending.close();
          this.pendingCleanup.delete(pending);
        }
      });
    return this.cleanup;
  }
  command(input: unknown): Promise<NetworkReply> {
    const command = decodeNetworkCommand(input);
    if (command.action === 'read')
      return Promise.resolve(
        this.closed
          ? { ok: false, error: 'NETWORK_NOT_READY' }
          : decodeNetworkReply({ ok: true, view: this.snapshot() }),
      );
    const reply = this.mutations.then(() => this.perform(command));
    this.mutations = reply.then(
      () => undefined,
      () => undefined,
    );
    return reply;
  }
  private async perform(command: NetworkCommand): Promise<NetworkReply> {
    if (this.closed) return { ok: false, error: 'NETWORK_NOT_READY' };
    try {
      switch (command.action) {
        case 'read':
          break;
        case 'connect':
          await this.queueCleanup();
          if (this.view.state === 'failed' || this.view.state === 'expired') await this.stop(false);
          await this.start();
          break;
        case 'disconnect':
          await this.stop(false);
          break;
        case 'sign-out':
          await this.stop(true);
          break;
        case 'refresh':
          if (this.component) {
            await this.component.command('status');
            void this.discovery.update(this.peers).catch(() => undefined);
          }
          break;
        case 'open-login':
          if (!this.login) throw Error('NETWORK_LOGIN_UNAVAILABLE');
          await this.deps.openLogin(validateLoginUrl(this.login));
          break;
      }
      return decodeNetworkReply({ ok: true, view: this.snapshot() });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && /^NETWORK_[A-Z_]+$/u.test(error.message)
            ? error.message
            : 'NETWORK_UNAVAILABLE',
      };
    }
  }
  private async stop(signOut: boolean): Promise<void> {
    ++this.generation;
    this.login = undefined;
    this.peers = [];
    this.discovery.clear();
    const component = this.component;
    this.component = undefined;
    this.view = empty();
    this.emit();
    let failure = false;
    try {
      await this.queueCleanup();
      if (!signOut) await this.deps.rememberEnabled?.(false);
      if (component) await component.command(signOut ? 'sign-out' : 'disconnect');
    } catch {
      failure = true;
    } finally {
      try {
        if (component) await this.queueCleanup(component);
      } catch {
        failure = true;
      }
    }
    if (!failure && signOut) {
      try {
        await this.deps.forgetEnrollment?.();
      } catch {
        failure = true;
      }
    }
    if (failure) {
      this.view = {
        ...empty(),
        state: 'failed',
        error: signOut ? 'NETWORK_SIGNOUT_INCOMPLETE' : 'NETWORK_CLEANUP_FAILED',
      };
      this.emit();
    }
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      ++this.generation;
      this.discovery.clear();
      this.listeners.clear();
      await this.mutations;
      const component = this.component;
      this.component = undefined;
      await this.queueCleanup(component);
    })().catch((error) => {
      this.closing = undefined;
      throw error;
    }));
  }
}
