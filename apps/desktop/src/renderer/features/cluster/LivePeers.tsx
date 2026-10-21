import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Toast } from '../../components/Toast';
import type { ToastMessage } from '../../components/Toast';
import { decodePeerReply } from '../../../shared/peers';
import type { PeerCommand, PeerView } from '../../../shared/peers';
import styles from './ClusterPage.module.css';
import settings from '../settings/SettingsPage.module.css';
import checkboxes from '../../components/Checkbox.module.css';
import switches from '../../components/Switch.module.css';
import layout from './ClusterViews.module.css';
import { ConfigurationSelect } from '../models/ConfigurationControls';

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

export function LivePeerRequests() {
  const { view, busy, run, toast } = usePeers();
  const [verifying, setVerifying] = useState<string | null>(null);
  const selected = view?.incoming.find(
    (value) => value.id === verifying && value.phase === 'pending',
  );
  const requests = view?.incoming.filter((peer) => peer.phase === 'pending') ?? [];
  return (
    <section className={settings.section} aria-label="Requests">
      {toast}
      <h2>Requests</h2>
      <div className={settings.group}>
        {!view && (
          <div className={settings.row}>
            <p className={settings.description}>Loading peer requests…</p>
          </div>
        )}
        {view && requests.length === 0 && (
          <div className={settings.row}>
            <p className={settings.description}>No pending requests.</p>
          </div>
        )}
        {requests.map((request) => (
          <div key={request.id} className={settings.row}>
            <div>
              <span className={settings.label}>{request.name}</span>
              <p className={settings.description}>Invites this PC to contribute to its cluster.</p>
              {request.localVerified && (
                <p className={styles.requestStatus}>
                  Waiting for the other PC to verify your identity.
                </p>
              )}
            </div>
            <div className={styles.joiningActions}>
              <Button
                disabled={busy || request.localVerified}
                className={styles.whiteAction}
                aria-label={'Approve ' + request.name}
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
          </div>
        ))}
      </div>
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

export function LivePeerPanel({ kind }: { kind: 'add' | 'join' | 'share'; expanded?: boolean }) {
  const { view, busy, run, toast, fallback } = usePeers();
  const [selected, setSelected] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [bindAddress, setBindAddress] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const source =
    bindAddress ||
    view?.addresses.find((value) => value.startsWith('100.')) ||
    view?.addresses[0] ||
    '';
  const verifyingPeer = view?.outgoing.find((value) => value.id === verifying);
  const coordinators =
    view?.incoming.filter(
      (peer) => peer.phase === 'approved' && peer.localVerified && peer.remoteVerified,
    ) ?? [];
  if (kind === 'share')
    return (
      <>
        {toast}
        <section className={settings.section}>
          <div className={layout.sectionHeader}>
            <h2>PCs that can use this PC</h2>
            <div className={layout.actions}>
              <button
                type="button"
                ref={fallback}
                aria-label="Refresh connections"
                className={layout.refresh}
                disabled={busy}
                onClick={() => {
                  void run({ action: 'read' });
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <Button
                className={styles.whiteAction}
                disabled={!view}
                onClick={() => setShowAdd(true)}
              >
                Add
              </Button>
            </div>
          </div>
          <div className={settings.group}>
            <div className={settings.row}>
              <div>
                <label htmlFor={id} className={settings.label}>
                  Allow connections
                </label>
                <p id={id + '-hint'} className={settings.description}>
                  Sharing allows requests. You approve each PC before it gets access.
                </p>
              </div>
              <input
                id={id}
                type="checkbox"
                role="switch"
                aria-describedby={id + '-hint'}
                checked={view?.sharing ?? false}
                disabled={!view || busy || (!view.sharing && (!selected.length || !source))}
                className={switches.switch}
                onChange={() => {
                  void run(
                    view?.sharing
                      ? { action: 'stop-sharing' }
                      : { action: 'share', address: source, gpuIds: selected },
                  );
                }}
              />
            </div>
            {coordinators.map((peer) => (
              <div key={peer.id} className={settings.row}>
                <div className={layout.connectionIdentity}>
                  <Monitor size={20} aria-hidden="true" />
                  <div>
                    <span className={settings.label}>{peer.name}</span>
                    <p className={settings.description}>Approved coordinator</p>
                  </div>
                </div>
                <Button
                  disabled={busy}
                  aria-label={'Revoke access for ' + peer.name}
                  onClick={() => {
                    void run({ action: 'decline', id: peer.id });
                  }}
                >
                  Revoke access
                </Button>
              </div>
            ))}
            {view && !coordinators.length && (
              <div className={settings.row}>
                <p className={settings.description}>No approved PCs.</p>
              </div>
            )}
          </div>
        </section>
        <section className={settings.section}>
          <h2>Shared hardware</h2>
          <div className={settings.group}>
            {!view && (
              <div className={settings.row}>
                <p className={settings.description}>Loading GPUs…</p>
              </div>
            )}
            {view && !view.gpus.length && (
              <div className={settings.row}>
                <p className={settings.description}>No GPUs available to share.</p>
              </div>
            )}
            {view?.gpus.map((gpu) => (
              <label key={gpu.id} className={settings.row}>
                <div>
                  <span className={settings.label}>{gpu.name}</span>
                  <p className={settings.description}>
                    {(gpu.memoryBytes / 1073741824).toFixed(1)} GiB dedicated memory
                  </p>
                </div>
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
                        : values.filter((value) => value !== gpu.id),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </section>
        <section className={settings.section}>
          <h2>Connection address</h2>
          <div className={settings.group}>
            <div className={settings.row}>
              <span className={settings.label}>This PC's address</span>
              <ConfigurationSelect
                id={id + '-address'}
                label="This PC's address"
                value={source}
                options={
                  view?.addresses.length
                    ? view.addresses.map((address) => ({ value: address, label: address }))
                    : [{ value: '', label: 'No private address available' }]
                }
                disabled={busy || !view || view.sharing || !view.addresses.length}
                onChange={setBindAddress}
              />
            </div>
          </div>
        </section>
        {showAdd && (
          <Dialog
            title="Connect another PC"
            onClose={() => setShowAdd(false)}
            initialFocus="cancel"
          >
            <p>
              {view?.sharing
                ? 'On the other PC, open Connections → Add device and enter this address.'
                : 'Select the GPUs and turn on Allow connections before inviting another PC.'}
            </p>
            <p className={layout.identityDetails}>{source}</p>
            <p>
              Approve its invitation in Requests below. Compare both app identities before
              approving.
            </p>
            <div className={styles.joiningActions}>
              <Button data-dialog-cancel onClick={() => setShowAdd(false)}>
                Done
              </Button>
            </div>
          </Dialog>
        )}
      </>
    );
  return (
    <>
      {toast}
      <section className={settings.section}>
        <div className={layout.sectionHeader}>
          <h2>{kind === 'add' ? 'PCs available to add' : 'Available clusters'}</h2>
          <div className={layout.actions}>
            <button
              type="button"
              ref={fallback}
              aria-label="Refresh connections"
              className={layout.refresh}
              disabled={busy}
              onClick={() => {
                void run({ action: 'read' });
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <Button
              className={styles.whiteAction}
              disabled={kind === 'join'}
              onClick={() => input.current?.focus()}
            >
              Add
            </Button>
          </div>
        </div>
        <div className={settings.group}>
          <div className={settings.row}>
            <p className={settings.description}>
              {kind === 'add' ? 'No available devices' : 'No available clusters'}
            </p>
          </div>
        </div>
      </section>
      <section className={settings.section}>
        <h2>Connect manually</h2>
        <form
          className={settings.group}
          onSubmit={(event) => {
            event.preventDefault();
            if (kind === 'add' && address.trim() && !busy)
              void run({ action: 'invite', address: address.trim() });
          }}
        >
          <div className={layout.fieldRow}>
            <label htmlFor={id + '-remote'} className={settings.label}>
              {kind === 'add' ? 'Private address' : 'Coordinator address'}
            </label>
            <input
              ref={input}
              id={id + '-remote'}
              aria-label="Private address"
              aria-describedby={id + '-instructions'}
              value={address}
              maxLength={255}
              placeholder="Enter a private IP address"
              disabled={busy || kind === 'join' || !window.modelLoomPeers}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className={layout.formActions}>
            <Button
              type="submit"
              className={styles.whiteAction}
              disabled={busy || !address.trim() || kind === 'join'}
            >
              {kind === 'add' ? 'Invite' : 'Request to join'}
            </Button>
          </div>
        </form>
        <p id={id + '-instructions'} className={layout.note}>
          {kind === 'add'
            ? 'The other PC must enable sharing and approve your invitation in Connections → Share this PC → Requests.'
            : 'Use Add device on the coordinator to invite this PC. Join requests are not enabled yet.'}
        </p>
      </section>
      {kind === 'add' && view && view.outgoing.length > 0 && (
        <section className={settings.section}>
          <h2>Invitations and shared PCs</h2>
          <div className={settings.group}>
            {view.outgoing.map((peer) => (
              <div key={peer.id} className={settings.row}>
                <div>
                  <span className={settings.label}>{peer.name}</span>
                  <p className={settings.description}>
                    {peer.phase === 'approved'
                      ? 'Approved worker'
                      : peer.phase === 'disconnected'
                        ? 'Not connected'
                        : 'Waiting for approval'}
                  </p>
                  {peer.gpus.map((gpu) => (
                    <p key={gpu.id} className={settings.description}>
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
          </div>
        </section>
      )}
      {view && verifyingPeer && (
        <VerifyPeer
          key={view.fingerprint + ':' + verifyingPeer.id + ':' + verifyingPeer.peerFingerprint}
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
