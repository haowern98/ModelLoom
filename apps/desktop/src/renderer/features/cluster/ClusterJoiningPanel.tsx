import { useId, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { Button } from '../../components/Button';
import { incomingExamples, joiningExamples } from '../../mocks/clusterJoining';
import type { DemoJoining, JoiningAction } from '../../mocks/clusterJoining';
import styles from './ClusterPage.module.css';
import settings from '../settings/SettingsPage.module.css';
import layout from './ClusterViews.module.css';
import switches from '../../components/Switch.module.css';
import checkboxStyles from '../../components/Checkbox.module.css';
import { LivePeerPanel, LivePeerRequests } from './LivePeers';

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
  if (!demo) return <LivePeerRequests />;
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
  const [address, setAddress] = useState(() => joining.manual[kind + ':LAN'] ?? '');
  const addressId = useId();
  const descriptionId = useId();
  const addressInput = useRef<HTMLInputElement>(null);
  if (!demo) return <LivePeerPanel kind={kind} expanded={expanded} />;
  if (kind === 'share') {
    return (
      <>
        <section className={settings.section}>
          <h2>PCs that can use this PC</h2>
          <div className={settings.group}>
            <div className={settings.row}>
              <div>
                <label htmlFor={addressId} className={settings.label}>
                  Allow connections
                </label>
                <p id={descriptionId} className={settings.description}>
                  You approve each invitation before this PC joins.
                </p>
              </div>
              <input
                id={addressId}
                type="checkbox"
                role="switch"
                aria-describedby={descriptionId}
                className={switches.switch}
                checked={joining.sharing}
                onChange={(event) => onJoining({ type: 'sharing', enabled: event.target.checked })}
              />
            </div>
            <div className={settings.row}>
              <p className={settings.description}>No approved PCs · demo</p>
            </div>
          </div>
        </section>
        <section className={settings.section}>
          <h2>Shared hardware</h2>
          <div className={settings.group}>
            {(['gpu', 'cpu'] as const).map((hardware) => (
              <label key={hardware} className={settings.row}>
                <span className={settings.label}>{hardware.toUpperCase()}</span>
                <input
                  type="checkbox"
                  className={checkboxStyles.checkbox}
                  checked={joining[hardware]}
                  disabled={!joining.sharing}
                  onChange={(event) =>
                    onJoining({ type: 'hardware', hardware, enabled: event.target.checked })
                  }
                />
              </label>
            ))}
          </div>
          <p className={layout.note}>
            Sharing preferences are kept for this app session only. No device is advertised.
          </p>
        </section>
      </>
    );
  }
  const manualKey = kind + ':LAN';
  const manualPending = Boolean(address.trim()) && joining.manual[manualKey] === address.trim();
  return (
    <>
      <section className={settings.section}>
        <div className={layout.sectionHeader}>
          <h2>{kind === 'add' ? 'PCs available to add' : 'Available clusters'}</h2>
          <Button className={styles.whiteAction} onClick={() => addressInput.current?.focus()}>
            Add
          </Button>
        </div>
        <div className={settings.group}>
          {joiningExamples[kind].map((device) => {
            const key = kind + ':LAN:' + device.id;
            const pending = joining.outgoing[key];
            return (
              <div key={key} className={settings.row}>
                <div>
                  <span className={settings.label}>{device.name}</span>
                  <p className={settings.description}>{device.detail}</p>
                </div>
                <Button
                  className={pending ? undefined : styles.whiteAction}
                  disabled={pending}
                  aria-label={
                    pending
                      ? (kind === 'add' ? 'Invitation' : 'Join request') +
                        ' pending for ' +
                        device.name
                      : (kind === 'add' ? 'Invite' : 'Request to join') + ' ' + device.name
                  }
                  onClick={() => onJoining({ type: 'request', key })}
                >
                  {pending ? 'Pending' : kind === 'add' ? 'Invite' : 'Request to join'}
                </Button>
              </div>
            );
          })}
        </div>
        <p className={layout.note}>
          Example devices · not discovered.{' '}
          {kind === 'add'
            ? 'The other PC must approve your invitation.'
            : 'The coordinator must approve your request.'}
        </p>
      </section>
      <section className={settings.section}>
        <h2>Connect manually</h2>
        <form
          className={settings.group}
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim() && !manualPending)
              onJoining({ type: 'manual', key: manualKey, address: address.trim() });
          }}
        >
          <div className={layout.fieldRow}>
            <label htmlFor={addressId} className={settings.label}>
              {kind === 'add' ? 'Private address' : 'Coordinator address'}
            </label>
            <input
              ref={addressInput}
              id={addressId}
              aria-label="Private address"
              aria-describedby={descriptionId}
              value={address}
              maxLength={255}
              placeholder="Enter a private IP address"
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className={layout.formActions}>
            <Button
              type="submit"
              className={styles.whiteAction}
              disabled={!address.trim() || manualPending}
              aria-label={
                kind === 'add' ? 'Invite private address' : 'Request to join private address'
              }
            >
              {kind === 'add' ? 'Invite' : 'Request to join'}
            </Button>
          </div>
        </form>
        {manualPending && (
          <p className={styles.requestStatus} role="status">
            {kind === 'add' ? 'Invitation' : 'Join request'} pending · demo
          </p>
        )}
        <p id={descriptionId} className={layout.note}>
          No discovery, request delivery or pairing occurs. LAN integration is not connected.
        </p>
      </section>
    </>
  );
}
