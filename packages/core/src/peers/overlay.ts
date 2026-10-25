import type { Duplex } from 'node:stream';

/** Trusted network-owner capability, never a renderer or peer-supplied destination API. */
export interface PeerOverlay {
  addresses(): readonly string[];
  dial(address: string, port: number, signal?: AbortSignal): Promise<Duplex>;
  subscribe(listener: () => void): () => void;
  incoming(listener: (port: number, stream: Duplex) => void): () => void;
}
export interface PeerOverlayTransport {
  has(address: string): boolean;
  dial(address: string, port: number, signal?: AbortSignal): Promise<Duplex>;
}
