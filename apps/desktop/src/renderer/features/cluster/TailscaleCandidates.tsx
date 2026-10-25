import { useEffect, useRef, useState } from 'react';
import type { NetworkView } from '../../../shared/network';
import { Button } from '../../components/Button';
import settings from '../settings/SettingsPage.module.css';

const inviteErrors: Record<string, string> = {
  PAIRING_LIMIT: 'Too many pairing requests. Wait a minute and try again.',
  PEER_TIMEOUT: 'The connection to the other PC timed out. Try again.',
  OVERLAY_DISCONNECTED: 'The Tailscale connection closed before pairing completed. Try again.',
  OVERLAY_UNAVAILABLE: 'The Tailscale route is not ready. Wait for reconnection, then try again.',
  NETWORK_ROUTE_UNAVAILABLE:
    'The Tailscale route is not ready. Wait for reconnection, then try again.',
  PEER_IDENTITY_CHANGED: 'The device identity changed. Forget the old device, then pair again.',
};

/** Discovery is informational; only an explicit Connect starts existing pairing. */
export function TailscaleCandidates({ onInvited }: { onInvited: (id: string) => void }) {
  const bridge = window.modelLoomNetwork;
  const [view, setView] = useState<NetworkView>();
  const [error, setError] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const dirty = useRef(false);
  const inviting = useRef(false);
  async function read() {
    if (!bridge) return;
    if (pending.current) {
      dirty.current = true;
      return;
    }
    pending.current = true;
    try {
      const reply = await bridge.command({ action: 'read' });
      if (!mounted.current) return;
      if (reply.ok) {
        setView(reply.view);
        setError(false);
      } else setError(true);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (mounted.current && dirty.current) {
        dirty.current = false;
        void read();
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = bridge?.subscribe(() => {
      void read();
    });
    void read();
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
    // The preload bridge is fixed for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  async function invite(candidate: NonNullable<NetworkView>['candidates'][number]) {
    if (!bridge?.invite || inviting.current) return;
    inviting.current = true;
    setBusy(true);
    setInviteError(null);
    try {
      const reply = await bridge.invite(candidate.id);
      if (!mounted.current) return;
      const request = reply.ok
        ? reply.view.outgoing.find(
            (peer) =>
              (peer.phase === 'pending' ||
                (peer.phase === 'approved' && peer.localVerified && peer.remoteVerified)) &&
              peer.peerFingerprint === candidate.fingerprint &&
              peer.address === candidate.address,
          )
        : undefined;
      if (!request)
        setInviteError(
          (!reply.ok && inviteErrors[reply.error]) ||
            'Could not connect to this PC. Check its sharing and try again.',
        );
      else {
        setError(false);
        if (request.phase === 'pending') onInvited(request.id);
      }
    } catch {
      if (mounted.current)
        setInviteError('Could not connect to this PC. Check its sharing and try again.');
    } finally {
      inviting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const candidates = view?.state === 'connected' ? view.candidates : [];
  const empty =
    !view || view.state === 'starting' || view.state === 'reconnecting'
      ? 'Searching for ModelLoom PCs…'
      : view.state === 'connected'
        ? 'No eligible ModelLoom PCs found on your tailnet.'
        : 'Connect to Tailscale in Network settings to discover PCs.';
  return (
    <>
      {error && (
        <div className={settings.row} role="alert">
          <p className={settings.description}>
            Could not update or connect to Tailscale devices. Try again.
          </p>
          <Button disabled={busy} onClick={() => void read()}>
            Retry discovery
          </Button>
        </div>
      )}
      {inviteError && (
        <div className={settings.row} role="alert">
          <p className={settings.description}>{inviteError}</p>
        </div>
      )}
      {!candidates.length && (
        <div className={settings.row}>
          <p className={settings.description}>{empty}</p>
        </div>
      )}
      {candidates.map((candidate) => (
        <div className={settings.row} key={candidate.id}>
          <div>
            <p className={settings.label}>{candidate.name}</p>
            <p className={settings.description}>Tailscale</p>
          </div>
          <Button
            disabled={busy || !bridge?.invite || error}
            aria-label={'Connect to ' + candidate.name}
            onClick={() => void invite(candidate)}
          >
            Connect
          </Button>
        </div>
      ))}
    </>
  );
}
