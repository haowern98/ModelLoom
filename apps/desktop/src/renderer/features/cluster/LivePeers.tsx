import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Toast } from '../../components/Toast';
import type { ToastMessage } from '../../components/Toast';
import { decodePeerReply } from '../../../shared/peers';
import type { PeerCommand, PeerView } from '../../../shared/peers';
import styles from './ClusterPage.module.css';
import settings from '../settings/SettingsPage.module.css';
import checkboxes from '../../components/Checkbox.module.css';

const errors: Record<string, string> = {
  NOT_READY: 'Peer connections are not ready. Wait for startup to finish.',
  PEER_UNAVAILABLE:
    'Could not connect. Check the address, sharing and Windows Firewall on the other PC.',
  PEER_IDENTITY_UNAVAILABLE:
    'The app identity could not be opened. Existing identity data was kept.',
  FINGERPRINT_MISMATCH: 'The identity fingerprints do not match. Do not approve this connection.',
  PEER_DECLINED: 'The other PC declined this request.',
  PAIRING_LIMIT: 'Too many pairing requests. Wait a minute and try again.',
};
function usePeers() {
  const [view, setView] = useState<PeerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const fallback = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true),
    working = useRef(false),
    epoch = useRef(0);
  const run = useCallback(async (command: PeerCommand, poll = false): Promise<boolean> => {
    if (working.current && poll) return false;
    if (!poll) {
      working.current = true;
      setBusy(true);
      ++epoch.current;
    }
    const operation = epoch.current;
    try {
      const bridge = window.modelLoomPeers;
      if (!bridge) throw new Error('NOT_READY');
      const reply = decodePeerReply(await bridge.command(command));
      if (!reply.ok) throw new Error(reply.error);
      if (mounted.current && operation === epoch.current) setView(reply.view);
      return true;
    } catch (error) {
      if (mounted.current && !poll) {
        const code = error instanceof Error ? error.message : 'PEER_UNAVAILABLE';
        setNotification({
          id: Date.now(),
          kind: 'error',
          message: errors[code] ?? 'The peer operation failed. Please try again.',
          origin: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        });
      }
      return false;
    } finally {
      if (!poll) {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await run({ action: 'read' }, true);
      if (mounted.current)
        timer = setTimeout(() => {
          void poll();
        }, 1500);
    };
    void poll();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [run]);
  return {
    view,
    busy,
    run,
    fallback,
    toast: notification ? (
      <Toast
        key={notification.id}
        notification={notification}
        fallbackRef={fallback}
        onDismiss={() => setNotification(null)}
      />
    ) : null,
  };
}

function VerifyPeer({
  local,
  remote,
  action,
  onClose,
  onVerify,
  busy,
}: {
  local: string;
  remote: string;
  action: 'approve' | 'confirm';
  onClose: () => void;
  onVerify: () => void;
  busy: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Dialog title="Verify app identities" onClose={onClose} initialFocus="cancel">
      <p>Compare both complete fingerprints with those shown on the other PC.</p>
      <p>This PC</p>
      <p className={styles.panelDescription} style={{ overflowWrap: 'anywhere' }}>
        {local}
      </p>
      <p>Other PC</p>
      <p className={styles.panelDescription} style={{ overflowWrap: 'anywhere' }}>
        {remote}
      </p>
      <label>
        <input
          className={checkboxes.checkbox}
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />{' '}
        I checked both fingerprints on both PCs.
      </label>
      <div className={styles.joiningActions}>
        <Button data-dialog-cancel onClick={onClose}>
          Cancel
        </Button>
        <Button className={styles.whiteAction} disabled={!checked || busy} onClick={onVerify}>
          {action === 'approve' ? 'Approve verified identity' : 'Confirm verified identity'}
        </Button>
      </div>
    </Dialog>
  );
}

/** Lists owner-reported approvals; an approval alone does not establish remote liveness. */
export function LivePeerConnections() {
  const { view, busy, run, toast } = usePeers();
  const coordinators =
    view?.incoming.filter(
      (peer) => peer.phase === 'approved' && peer.localVerified && peer.remoteVerified,
    ) ?? [];
  const workers =
    view?.outgoing.filter(
      (peer) =>
        peer.localVerified &&
        ((peer.phase === 'approved' && peer.remoteVerified) || peer.phase === 'disconnected'),
    ) ?? [];
  return (
    <>
      {toast}
      <div className={settings.group}>
        {!view && (
          <div className={settings.row}>
            <p className={settings.description}>Loading connections…</p>
          </div>
        )}
        {view && !coordinators.length && !workers.length && (
          <div className={settings.row}>
            <p className={settings.description}>No approved connections.</p>
          </div>
        )}
        {coordinators.map((peer) => (
          <div key={`coordinator:${peer.id}`} className={settings.row}>
            <div>
              <span className={settings.label}>{peer.name}</span>
              <p className={settings.description}>Approved coordinator</p>
            </div>
            <Button
              disabled={busy}
              aria-label={`Revoke access for ${peer.name}`}
              onClick={() => {
                void run({ action: 'decline', id: peer.id });
              }}
            >
              Revoke access
            </Button>
          </div>
        ))}
        {workers.map((peer) => (
          <div key={`worker:${peer.id}`} className={settings.row}>
            <div>
              <span className={settings.label}>{peer.name}</span>
              <p className={settings.description}>
                {peer.phase === 'approved' ? 'Approved worker' : 'Not connected'}
              </p>
              {peer.gpus.map((gpu) => (
                <p key={gpu.id} className={settings.description}>
                  {gpu.name} · {(gpu.memoryBytes / 1073741824).toFixed(1)} GiB
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function LivePeerRequests() {
  const { view, busy, run, toast } = usePeers();
  const [verifying, setVerifying] = useState<string | null>(null);
  const selected = view?.incoming.find(
    (value) => value.id === verifying && value.phase === 'pending',
  );
  return (
    <section className={settings.section} aria-label="Participation requests">
      {toast}
      <h2>Participation requests</h2>
      {!view && <p className={styles.panelDescription}>Loading peer requests…</p>}
      {view && !view.incoming.length && (
        <div className={settings.group}>
          <div className={settings.row}>
            <p className={settings.description}>No participation requests.</p>
          </div>
        </div>
      )}
      {view?.incoming.map((request) => (
        <div key={request.id} className={styles.requestRow}>
          <div>
            <span className={styles.joiningName}>{request.name}</span>
            <p className={styles.panelDescription}>Invites this PC to contribute to its cluster.</p>
            {request.localVerified && request.phase === 'pending' && (
              <p className={styles.requestStatus}>
                Waiting for the other PC to verify your identity.
              </p>
            )}
          </div>
          {request.phase === 'pending' ? (
            <div className={styles.joiningActions}>
              <Button
                disabled={busy || request.localVerified}
                className={styles.whiteAction}
                aria-label={`Approve ${request.name}`}
                onClick={() => setVerifying(request.id)}
              >
                Approve
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void run({ action: 'decline', id: request.id });
                }}
              >
                Decline
              </Button>
            </div>
          ) : (
            <p className={styles.requestStatus}>
              {request.phase === 'approved' ? 'Approved' : 'Declined'}
            </p>
          )}
        </div>
      ))}
      {view && selected && (
        <VerifyPeer
          key={`${view.fingerprint}:${selected.id}:${selected.peerFingerprint}`}
          local={view.fingerprint}
          remote={selected.peerFingerprint}
          action="approve"
          busy={busy}
          onClose={() => setVerifying(null)}
          onVerify={() => {
            void run({
              action: 'approve',
              id: selected.id,
              fingerprint: selected.peerFingerprint,
            }).then((ok) => {
              if (ok) setVerifying(null);
            });
          }}
        />
      )}
    </section>
  );
}

export function LivePeerPanel({
  kind,
  expanded = false,
}: {
  kind: 'add' | 'join' | 'share';
  expanded?: boolean;
}) {
  const { view, busy, run, toast, fallback } = usePeers();
  const [selected, setSelected] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [bindAddress, setBindAddress] = useState('');
  const [mode, setMode] = useState('LAN');
  const [manualOpen, setManualOpen] = useState(!expanded);
  const [verifying, setVerifying] = useState<string | null>(null);
  const source =
    bindAddress ||
    view?.addresses.find((value) => value.startsWith('100.')) ||
    view?.addresses[0] ||
    '';
  const verifyingPeer = view?.outgoing.find((value) => value.id === verifying);
  if (kind === 'share')
    return (
      <>
        {toast}
        <p className={styles.panelDescription}>Choose which GPUs another approved PC may use.</p>
        <section className={styles.panelSection}>
          <div className={styles.sharingRow}>
            <label htmlFor="peer-sharing" className={styles.joiningName}>
              Allow participation requests
            </label>
            <button
              ref={fallback}
              id="peer-sharing"
              role="switch"
              type="button"
              aria-checked={view?.sharing ?? false}
              disabled={!view || busy || (!view.sharing && (!selected.length || !source))}
              className={styles.sharingSwitch}
              onClick={() => {
                void run(
                  view?.sharing
                    ? { action: 'stop-sharing' }
                    : { action: 'share', address: source, gpuIds: selected },
                );
              }}
            >
              <span />
            </button>
          </div>
          <p className={styles.panelDescription}>
            Sharing allows requests. You approve each PC before it gets access.
          </p>
        </section>
        <section className={styles.panelSection}>
          <h3>Hardware to share</h3>
          {!view && <p className={styles.panelDescription}>Loading GPUs…</p>}
          {view?.gpus.map((gpu) => (
            <label key={gpu.id} className={styles.requestRow}>
              <input
                type="checkbox"
                className={checkboxes.checkbox}
                disabled={busy || view.sharing}
                checked={
                  view.sharing ? view.sharedGpuIds.includes(gpu.id) : selected.includes(gpu.id)
                }
                onChange={(event) =>
                  setSelected((values) =>
                    event.target.checked
                      ? [...values, gpu.id]
                      : values.filter((id) => id !== gpu.id),
                  )
                }
              />
              {gpu.name} · {(gpu.memoryBytes / 1073741824).toFixed(1)} GiB
            </label>
          ))}
        </section>
        <section className={styles.panelSection}>
          <h3>Connection address</h3>
          <div className={styles.networkModes}>
            {view?.addresses.map((value) => (
              <Button
                key={value}
                disabled={busy || view.sharing}
                aria-pressed={source === value}
                onClick={() => setBindAddress(value)}
              >
                {value}
              </Button>
            ))}
          </div>
          <p className={styles.panelDescription}>
            {view?.sharing
              ? `On the other PC, choose Add device and enter ${source}.`
              : 'Select a GPU and an address, then turn on sharing.'}
          </p>
          {view && (
            <p className={styles.panelDescription} style={{ overflowWrap: 'anywhere' }}>
              App identity: {view.fingerprint}
            </p>
          )}
        </section>
      </>
    );
  return (
    <>
      {toast}
      <p className={styles.panelDescription}>
        {kind === 'add'
          ? 'Invite another PC to contribute to your cluster.'
          : 'Ask a coordinator to use this PC in its cluster.'}
      </p>
      <div className={styles.networkModes} role="group" aria-label="Connection mode">
        {['LAN', 'Tailscale', 'Headscale'].map((value) => (
          <Button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
            {value}
          </Button>
        ))}
        {expanded && (
          <Button
            className={styles.whiteAction}
            aria-expanded={manualOpen}
            onClick={() => setManualOpen(!manualOpen)}
          >
            Connect manually
          </Button>
        )}
      </div>
      <section className={styles.panelSection}>
        <h3>{kind === 'add' ? 'Available devices' : 'Available clusters'}</h3>
        <p className={styles.panelDescription}>
          {kind === 'add' ? 'No available devices' : 'No available clusters'}
        </p>
      </section>
      {manualOpen && (
        <section className={styles.panelSection}>
          <h3>Private address</h3>
          <form
            className={styles.addressForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (kind === 'add' && address.trim())
                void run({ action: 'invite', address: address.trim() });
            }}
          >
            <input
              aria-label="Private address"
              value={address}
              maxLength={255}
              placeholder="Enter a private address…"
              disabled={busy || kind === 'join' || !window.modelLoomPeers}
              onChange={(event) => setAddress(event.target.value)}
            />
            <Button
              type="submit"
              className={styles.whiteAction}
              disabled={busy || !address.trim() || kind === 'join'}
            >
              Invite
            </Button>
          </form>
          <p className={styles.panelDescription}>
            {kind === 'add'
              ? 'The other PC must enable sharing and approve your invitation in Requests.'
              : 'Use Add device on the coordinator to invite this PC. Join requests are not enabled yet.'}
          </p>
        </section>
      )}
      {view?.outgoing.map((peer) => (
        <div key={peer.id} className={styles.requestRow}>
          <div>
            <span className={styles.joiningName}>{peer.name}</span>
            <p className={styles.requestStatus}>
              {peer.phase === 'approved'
                ? 'Approved'
                : peer.phase === 'disconnected'
                  ? 'Not connected'
                  : 'Waiting for approval'}
            </p>
            {peer.gpus.map((gpu) => (
              <p key={gpu.id} className={styles.panelDescription}>
                {gpu.name} · {(gpu.memoryBytes / 1073741824).toFixed(1)} GiB
              </p>
            ))}
          </div>
          {!peer.localVerified && (
            <Button disabled={busy} onClick={() => setVerifying(peer.id)}>
              Verify identity
            </Button>
          )}
        </div>
      ))}
      {view && verifyingPeer && (
        <VerifyPeer
          key={`${view.fingerprint}:${verifyingPeer.id}:${verifyingPeer.peerFingerprint}`}
          local={view.fingerprint}
          remote={verifyingPeer.peerFingerprint}
          action="confirm"
          busy={busy}
          onClose={() => setVerifying(null)}
          onVerify={() => {
            void run({
              action: 'confirm',
              id: verifyingPeer.id,
              fingerprint: verifyingPeer.peerFingerprint,
            }).then((ok) => {
              if (ok) setVerifying(null);
            });
          }}
        />
      )}
    </>
  );
}
