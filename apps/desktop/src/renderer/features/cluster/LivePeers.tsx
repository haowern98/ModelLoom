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
  SHARING_FIREWALL_FAILED:
    'Could not set up Windows Firewall for sharing. Try again and approve the Windows permission prompt.',
  SHARING_FIREWALL_PERMISSION_DENIED:
    'Windows permission was not granted. Allow ModelLoom to set up sharing, then try again.',
  RPC_SHARING_FAILED:
    'Could not start sharing on this PC. Approve the Windows permission prompts for the selected GPUs, then try again.',
  RPC_CLEANUP_FAILED:
    'Sharing cleanup could not be confirmed. Close and reopen ModelLoom before trying again.',
  PAIRING_CODE_INVALID: 'Incorrect verification code. Try again.',
  PAIRING_EXPIRED: 'Pairing expired. Connect again to get a new code.',
  PAIRING_ATTEMPTS_EXCEEDED: 'Too many attempts. Wait a minute, then connect again.',
  PAIRING_UPDATE_REQUIRED: 'Update ModelLoom on both PCs to pair.',
  PAIRING_NOT_VERIFIED: 'Verify the code before approving access.',
  PEER_TRUST_UNAVAILABLE: 'Trusted device data could not be saved. Please try again.',
  PEER_IDENTITY_CHANGED: 'The device identity changed. Forget the old device, then pair again.',
  UNKNOWN_PEER_REQUEST: 'This request expired or was cancelled. Start a new pairing request.',
  PAIRING_CODE_REQUIRED: 'Update ModelLoom on both PCs to use verification codes.',
  NOT_READY: 'Peer connections are not ready. Wait for startup to finish.',
  PEER_UNAVAILABLE:
    'Could not connect. Check the address, sharing and Windows Firewall on the other PC.',
  PEER_IDENTITY_UNAVAILABLE:
    'The app identity could not be opened. Existing identity data was kept.',
  FINGERPRINT_MISMATCH: 'The device identity could not be verified. Start a new pairing request.',
  PEER_DECLINED: 'The other PC declined this request.',
  PAIRING_LIMIT: 'Too many pairing requests. Wait a minute and try again.',
};
function usePeers() {
  const [view, setView] = useState<PeerView | null>(null);
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PeerCommand['action'] | null>(null);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const fallback = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true),
    working = useRef(false),
    epoch = useRef(0);
  const run = useCallback(async (command: PeerCommand, poll = false): Promise<boolean> => {
    if (working.current && poll) return false;
    if (!poll) {
      working.current = true;
      setBusy(true);
      setPendingAction(command.action);
      if (command.action === 'share') setSharingError(null);
      ++epoch.current;
    }
    const operation = epoch.current;
    try {
      const bridge = window.modelLoomPeers;
      if (!bridge) throw new Error('NOT_READY');
      const reply = decodePeerReply(await bridge.command(command));
      if (!reply.ok) throw new Error(reply.error);
      if (mounted.current && operation === epoch.current) {
        setView(reply.view);
        setReadError(false);
        if (command.action === 'invite')
          setInvited(
            reply.view.outgoing.find(
              (peer) =>
                peer.address ===
                  new URL(
                    command.address.includes('://') ? command.address : `http://${command.address}`,
                  ).hostname && peer.phase === 'pending',
            )?.id ?? null,
          );
      }
      return true;
    } catch (error) {
      if (mounted.current && operation === epoch.current && command.action === 'read')
        setReadError(true);
      if (mounted.current && !poll) {
        const code = error instanceof Error ? error.message : 'PEER_UNAVAILABLE';
        if (command.action === 'share')
          setSharingError(errors[code] ?? 'Could not start sharing on this PC. Please try again.');
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
        if (mounted.current) {
          setBusy(false);
          setPendingAction(null);
        }
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
    readError,
    busy,
    pendingAction,
    sharingError,
    run,
    fallback,
    invited,
    setInvited,
    retryNotice: readError ? (
      <div role="alert" className={settings.row}>
        <p className={settings.description}>Could not load connection details. Try again.</p>
        <Button
          disabled={busy}
          onClick={() => {
            void run({ action: 'read' });
          }}
        >
          Retry
        </Button>
      </div>
    ) : null,
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
  name,
  onClose,
  onVerify,
  busy,
}: {
  name: string;
  onClose: () => void;
  onVerify: (code: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [code, setCode] = useState('');
  return (
    <Dialog title={'Verify ' + name} onClose={onClose} initialFocus="cancel">
      <p>Enter the six-digit code shown on {name}.</p>
      <label className={layout.fieldRow}>
        Verification code
        <input
          aria-label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
        />
      </label>
      <div className={styles.joiningActions}>
        <Button data-dialog-cancel disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          className={styles.whiteAction}
          disabled={busy || !/^[0-9]{6}$/.test(code)}
          onClick={() => {
            void onVerify(code).then((ok) => {
              if (ok) setCode('');
            });
          }}
        >
          {busy ? 'Verifying...' : 'Verify'}
        </Button>
      </div>
    </Dialog>
  );
}

export function LivePeerRequests() {
  const { view, readError, busy, run, toast, retryNotice } = usePeers();
  const [verifying, setVerifying] = useState<string | null>(null);
  const selected = view?.incoming.find(
    (value) => value.id === verifying && value.phase === 'pending',
  );
  const requests = view?.incoming.filter((peer) => peer.phase === 'pending') ?? [];
  return (
    <section className={settings.section} aria-label="Requests">
      {toast}
      {retryNotice}
      <h2>Requests</h2>
      <div className={settings.group}>
        {!view && !readError && (
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
                <p className={styles.requestStatus}>Waiting for approval.</p>
              )}
            </div>
            <div className={styles.joiningActions}>
              <Button
                disabled={busy}
                className={styles.whiteAction}
                aria-label={'Review ' + request.name}
                onClick={() => setVerifying(request.id)}
              >
                Review
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
      {selected && (
        <Dialog
          title={'Pair with ' + selected.name}
          onClose={() => setVerifying(null)}
          initialFocus="cancel"
        >
          {selected.remoteVerified ? (
            <p>Allow {selected.name} to use your shared GPUs?</p>
          ) : (
            <>
              <p>Enter this code on {selected.name}.</p>
              <p
                aria-label="Pairing code"
                className={styles.panelTitle}
                style={{ textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.15em' }}
              >
                {selected.pairingCode
                  ? selected.pairingCode.slice(0, 3) + ' ' + selected.pairingCode.slice(3)
                  : 'Pairing code unavailable. Start a new request.'}
              </p>
              <p>Waiting for code verification...</p>
              <p>This code expires after 5 minutes.</p>
            </>
          )}
          <div className={styles.joiningActions}>
            <Button
              data-dialog-cancel
              disabled={busy}
              onClick={() => {
                void run({ action: 'decline', id: selected.id }).then((ok) => {
                  if (ok) setVerifying(null);
                });
              }}
            >
              Deny
            </Button>
            {selected.remoteVerified && (
              <Button
                disabled={busy}
                className={styles.whiteAction}
                onClick={() => {
                  void run({ action: 'approve', id: selected.id }).then((ok) => {
                    if (ok) setVerifying(null);
                  });
                }}
              >
                Allow
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function LivePeerPanel({ kind }: { kind: 'add' | 'share'; expanded?: boolean }) {
  const {
    view,
    readError,
    busy,
    pendingAction,
    sharingError,
    run,
    toast,
    retryNotice,
    fallback,
    invited,
    setInvited,
  } = usePeers();
  const startingSharing = pendingAction === 'share';
  const [excludedGpuIds, setExcludedGpuIds] = useState<string[]>([]);
  const selected =
    view?.gpus.filter((gpu) => !excludedGpuIds.includes(gpu.id)).map((gpu) => gpu.id) ?? [];
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
  const verifyingPeer = view?.outgoing.find((value) => value.id === (verifying ?? invited));
  const coordinators =
    view?.incoming.filter(
      (peer) => peer.phase === 'approved' && peer.localVerified && peer.remoteVerified,
    ) ?? [];
  if (kind === 'share')
    return (
      <>
        {toast}
        {retryNotice}
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
                <label htmlFor={id} className={`${settings.label} ${styles.sharingLabel}`}>
                  Allow connections
                  {startingSharing && (
                    <svg
                      data-testid="sharing-spinner"
                      className={styles.sharingSpinner}
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        opacity="0.3"
                        d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"
                        fill="currentColor"
                      />
                      <path
                        d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                </label>
                <p
                  id={id + '-hint'}
                  className={settings.description}
                  role="status"
                  aria-live="polite"
                >
                  {startingSharing
                    ? 'Starting sharing\u2026'
                    : 'Sharing allows requests. You approve each PC before it gets access.'}
                </p>
              </div>
              <input
                id={id}
                type="checkbox"
                role="switch"
                aria-describedby={id + '-hint'}
                checked={!startingSharing && (view?.sharing ?? false)}
                aria-busy={startingSharing}
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
            {sharingError && <p className={styles.sharingError}>{sharingError}</p>}
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
            {!view && !readError && (
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
                    setExcludedGpuIds((values) =>
                      event.target.checked
                        ? values.filter((value) => value !== gpu.id)
                        : [...values, gpu.id],
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
            <p>Open its request below to display the verification code, then approve access.</p>
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
      {retryNotice}
      <section className={settings.section}>
        <div className={layout.sectionHeader}>
          <h2>PCs available to add</h2>
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
            <Button className={styles.whiteAction} onClick={() => input.current?.focus()}>
              Add
            </Button>
          </div>
        </div>
        <div className={settings.group}>
          <div className={settings.row}>
            <p className={settings.description}>No available devices</p>
          </div>
        </div>
      </section>
      <section className={settings.section}>
        <h2>Connect manually</h2>
        <form
          className={settings.group}
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim() && !busy) void run({ action: 'invite', address: address.trim() });
          }}
        >
          <div className={layout.fieldRow}>
            <label htmlFor={id + '-remote'} className={settings.label}>
              Private address
            </label>
            <input
              ref={input}
              id={id + '-remote'}
              aria-label="Private address"
              aria-describedby={id + '-instructions'}
              value={address}
              maxLength={255}
              placeholder="Enter a LAN or Tailscale IP address"
              disabled={busy || !window.modelLoomPeers}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className={layout.formActions}>
            <Button type="submit" className={styles.whiteAction} disabled={busy || !address.trim()}>
              Connect
            </Button>
          </div>
        </form>
        <p id={id + '-instructions'} className={layout.note}>
          The other PC must enable sharing and approve your invitation in Connections → Share this
          PC → Requests.
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
                        : peer.phase === 'declined'
                          ? 'Request declined'
                          : !peer.localVerified
                            ? 'Waiting for code verification...'
                            : 'Waiting for the other PC to approve...'}
                  </p>
                  {peer.gpus.map((gpu) => (
                    <p key={gpu.id} className={settings.description}>
                      {gpu.name} · {(gpu.memoryBytes / 1073741824).toFixed(1)} GiB
                    </p>
                  ))}
                </div>
                {peer.phase === 'pending' && !peer.localVerified && (
                  <Button disabled={busy} onClick={() => setVerifying(peer.id)}>
                    Verify code
                  </Button>
                )}
                {((peer.phase === 'pending' && peer.localVerified) ||
                  peer.phase === 'disconnected' ||
                  peer.phase === 'declined') && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void run({ action: 'cancel', id: peer.id });
                    }}
                  >
                    {peer.phase === 'pending' ? 'Cancel' : 'Forget device'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {verifyingPeer && verifyingPeer.phase === 'pending' && !verifyingPeer.localVerified && (
        <VerifyPeer
          key={verifyingPeer.id}
          name={verifyingPeer.name}
          busy={busy}
          onClose={() => {
            void run({ action: 'cancel', id: verifyingPeer.id }).then((ok) => {
              if (ok) {
                setVerifying(null);
                setInvited(null);
              }
            });
          }}
          onVerify={async (code) => {
            const ok = await run({ action: 'verify-code', id: verifyingPeer.id, code });
            if (ok) {
              setVerifying(null);
              setInvited(null);
            }
            return ok;
          }}
        />
      )}
    </>
  );
}
