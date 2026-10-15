import { useEffect, useId, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { Button } from '../../components/Button';
import { incomingExamples, joiningExamples } from '../../mocks/clusterJoining';
import type { ConnectionMode, DemoJoining, JoiningAction } from '../../mocks/clusterJoining';
import styles from './ClusterPage.module.css';
import settings from '../settings/SettingsPage.module.css';

export interface JoiningProps {
  demo: boolean;
  joining: DemoJoining;
  onJoining: Dispatch<JoiningAction>;
}

/** Demonstrates request direction and explicit decisions without delivering or authorizing anything. */
export function PendingRequests({
  demo,
  joining,
  onJoining,
  settingsLayout = false,
}: JoiningProps & { settingsLayout?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  if (!demo) return null;
  const pending = incomingExamples.filter((request) => !joining.decisions[request.id]).length;
  const Heading = settingsLayout ? 'h2' : 'h3';
  return (
    <section
      className={settingsLayout ? settings.section : styles.panelSection}
      aria-label="Pending requests"
    >
      <Heading ref={heading} tabIndex={-1}>
        Pending requests <span className={styles.requestCount}>{pending}</span>
      </Heading>
      <p className={styles.panelDescription}>Example requests · approval is simulated.</p>
      <div className={settingsLayout ? settings.group : undefined}>
        {incomingExamples.map((request) => {
          const decision = joining.decisions[request.id];
          return (
            <div
              key={request.id}
              className={settingsLayout ? settings.row : styles.requestRow}
              role="group"
              aria-label={`${request.kind} from ${request.name}`}
            >
              <div>
                <span className={settingsLayout ? settings.label : styles.joiningName}>
                  {request.name}
                </span>
                <p className={settingsLayout ? settings.description : styles.panelDescription}>
                  {request.kind === 'invitation'
                    ? 'Invites this PC to its cluster.'
                    : 'Wants to join your cluster.'}
                </p>
                <p className={styles.roleConsequence}>
                  {request.kind === 'invitation'
                    ? `${request.name} coordinates; this PC contributes.`
                    : `This PC coordinates; ${request.name} contributes.`}
                </p>
              </div>
              {decision ? (
                <p className={styles.requestStatus}>
                  {decision === 'approved' ? 'Approved' : 'Declined'} · demo
                </p>
              ) : (
                <div className={settingsLayout ? settings.controls : styles.joiningActions}>
                  {(['approved', 'declined'] as const).map((next) => (
                    <Button
                      key={next}
                      className={next === 'approved' ? styles.whiteAction : undefined}
                      aria-label={`${next === 'approved' ? 'Approve' : 'Decline'} ${request.kind} from ${request.name}`}
                      onClick={() => {
                        onJoining({ type: 'decide', id: request.id, decision: next });
                        heading.current?.focus();
                      }}
                    >
                      {next === 'approved' ? 'Approve' : 'Decline'}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className={styles.panelDescription}>
        No device is connected or granted access by these demo actions.
      </p>
    </section>
  );
}

export function ClusterJoiningPanel({
  kind,
  demo,
  joining,
  onJoining,
  expanded = false,
}: JoiningProps & { kind: 'add' | 'join' | 'share'; expanded?: boolean }) {
  const [mode, setMode] = useState<ConnectionMode>('LAN');
  const [address, setAddress] = useState(() => joining.manual[`${kind}:LAN`] ?? '');
  const addressId = useId();
  const descriptionId = useId();
  const sharingSwitch = useRef<HTMLButtonElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(!expanded);
  useEffect(() => {
    if (expanded && manualOpen) addressInput.current?.focus();
  }, [expanded, manualOpen]);
  if (kind === 'share') {
    return (
      <>
        <p className={styles.panelDescription}>
          Choose whether this PC can receive participation requests.
        </p>
        <section className={styles.panelSection}>
          <div className={styles.sharingRow}>
            <label htmlFor={addressId} className={styles.joiningName}>
              Allow participation requests
            </label>
            <button
              ref={sharingSwitch}
              id={addressId}
              type="button"
              role="switch"
              aria-checked={joining.sharing}
              aria-describedby={descriptionId}
              className={styles.sharingSwitch}
              disabled={!demo}
              onClick={() => onJoining({ type: 'sharing', enabled: !joining.sharing })}
            >
              <span />
            </button>
          </div>
          <p id={descriptionId} className={styles.panelDescription}>
            You approve each invitation before this PC joins.
          </p>
        </section>
        <section className={styles.panelSection}>
          <h3>Hardware to share</h3>
          <div className={styles.hardwareChoices}>
            {(['gpu', 'cpu'] as const).map((hardware) => (
              <label key={hardware}>
                <input
                  type="checkbox"
                  checked={joining[hardware]}
                  disabled={!demo || !joining.sharing}
                  onChange={(event) =>
                    onJoining({ type: 'hardware', hardware, enabled: event.target.checked })
                  }
                />
                {hardware.toUpperCase()}
              </label>
            ))}
          </div>
        </section>
        <section className={styles.panelSection}>
          <h3>Participation</h3>
          <dl className={styles.details}>
            <div>
              <dt>Status</dt>
              <dd>{joining.sharing ? 'Available for requests · demo' : 'Not sharing'}</dd>
            </div>
            <div>
              <dt>Coordinator</dt>
              <dd>Not connected</dd>
            </div>
          </dl>
          <p className={styles.panelDescription}>Sharing availability does not start inference.</p>
          {joining.sharing && (
            <Button
              onClick={() => {
                onJoining({ type: 'sharing', enabled: false });
                sharingSwitch.current?.focus();
              }}
            >
              Stop sharing
            </Button>
          )}
        </section>
        <p className={styles.panelDescription}>
          {demo
            ? 'Sharing preferences are kept for this app session only. No device is advertised.'
            : 'Participation requires networking integration.'}
        </p>
      </>
    );
  }
  const manualKey = `${kind}:${mode}`;
  const manualPending = Boolean(address.trim()) && joining.manual[manualKey] === address.trim();
  return (
    <>
      <p className={styles.panelDescription}>
        {kind === 'add'
          ? 'Invite another PC to contribute to your cluster.'
          : 'Ask a coordinator to use this PC in its cluster.'}
      </p>
      <div className={styles.networkModes} role="group" aria-label="Connection mode">
        {(['LAN', 'Tailscale', 'Headscale'] as const).map((next) => (
          <Button
            key={next}
            aria-pressed={mode === next}
            onClick={() => {
              setMode(next);
              setAddress(joining.manual[`${kind}:${next}`] ?? '');
            }}
          >
            {next}
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
          {demo
            ? 'Example devices · not discovered'
            : kind === 'add'
              ? 'No available devices'
              : 'No available clusters'}
        </p>
        <div className={expanded ? styles.candidateGrid : undefined}>
          {demo &&
            joiningExamples[kind].map((device) => {
              const key = `${kind}:${mode}:${device.id}`;
              const pending = joining.outgoing[key];
              return (
                <div key={key} className={styles.candidateRow}>
                  <div>
                    <span className={styles.joiningName}>{device.name}</span>
                    <span className={styles.candidateDetail}>{device.detail}</span>
                  </div>
                  <Button
                    className={pending ? undefined : styles.whiteAction}
                    disabled={pending}
                    aria-label={
                      pending
                        ? `${kind === 'add' ? 'Invitation' : 'Join request'} pending for ${device.name}`
                        : `${kind === 'add' ? 'Invite' : 'Request to join'} ${device.name}`
                    }
                    onClick={() => onJoining({ type: 'request', key })}
                  >
                    {pending ? 'Pending' : kind === 'add' ? 'Invite' : 'Request to join'}
                  </Button>
                </div>
              );
            })}
        </div>
        <p className={styles.panelDescription}>
          {kind === 'add'
            ? 'The other PC must approve your invitation.'
            : 'The coordinator must approve your request.'}
        </p>
      </section>
      {manualOpen && (
        <section className={styles.panelSection}>
          <h3>Private address</h3>
          <form
            className={styles.addressForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (demo && address.trim() && !manualPending)
                onJoining({ type: 'manual', key: manualKey, address: address.trim() });
            }}
          >
            <input
              ref={addressInput}
              id={addressId}
              aria-label="Private address"
              aria-describedby={descriptionId}
              value={address}
              disabled={!demo}
              maxLength={255}
              placeholder="Enter a private address…"
              onChange={(event) => setAddress(event.target.value)}
            />
            <Button
              type="submit"
              className={styles.whiteAction}
              disabled={!demo || !address.trim() || manualPending}
              aria-label={
                kind === 'add' ? 'Invite private address' : 'Request to join private address'
              }
            >
              {kind === 'add' ? 'Invite' : 'Request to join'}
            </Button>
          </form>
          {manualPending && (
            <p className={styles.requestStatus} role="status">
              {kind === 'add' ? 'Invitation' : 'Join request'} pending · demo
            </p>
          )}
          <p id={descriptionId} className={styles.panelDescription}>
            No discovery, request delivery or pairing occurs. {mode} integration is not connected.
          </p>
        </section>
      )}
    </>
  );
}
