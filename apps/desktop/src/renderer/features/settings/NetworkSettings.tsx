import { useEffect, useRef, useState } from 'react';
import type { NetworkCommand, NetworkView } from '../../../shared/network';
import { Button } from '../../components/Button';
import { Row, Section } from './SettingsPage';
import styles from './SettingsPage.module.css';

const status: Record<NetworkView['state'], string> = {
  disconnected: 'Disconnected',
  starting: 'Starting Tailscale…',
  'needs-login': 'Sign in to Tailscale',
  'needs-approval': 'Waiting for device approval',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  expired: 'Sign-in expired',
  failed: 'Tailscale could not connect',
};

/** Presents only the safe network view; enrollment and browser login stay in the core. */
export function NetworkSettings({
  onApi,
  onConnections,
}: {
  onApi: () => void;
  onConnections?: () => void;
}) {
  const bridge = window.modelLoomNetwork;
  const [view, setView] = useState<NetworkView>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const dirty = useRef(false);

  async function command(action: NetworkCommand['action']) {
    if (!bridge || pending.current) {
      if (action === 'read') dirty.current = true;
      return;
    }
    pending.current = true;
    if (mounted.current) setBusy(true);
    try {
      const reply = await bridge.command({ action });
      if (!mounted.current) return;
      if (reply.ok) {
        setView(reply.view);
        setError(false);
      } else setError(true);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        if (dirty.current) {
          dirty.current = false;
          void command('read');
        }
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = bridge?.subscribe(() => {
      void command('read');
    });
    void command('read');
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
    // The preload bridge has a fixed identity for this page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  const state = view?.state;
  const signOutIncomplete = view?.error === 'NETWORK_SIGNOUT_INCOMPLETE';
  const signIn = state === 'needs-login' || state === 'expired';
  const active =
    state === 'starting' ||
    state === 'needs-login' ||
    state === 'needs-approval' ||
    state === 'reconnecting';
  return (
    <>
      <Section title="Tailscale">
        <Row label="Tailscale" description="Find and connect to ModelLoom PCs on your tailnet.">
          <span className={styles.muted} role="status">
            {!bridge
              ? 'Not available in this build'
              : view
                ? status[view.state]
                : error
                  ? 'Unavailable'
                  : 'Loading…'}
          </span>
        </Row>
        {state === 'needs-approval' && (
          <Row
            label="Device approval"
            description="Ask your tailnet administrator to approve this ModelLoom device."
          >
            <Button disabled={busy} onClick={() => void command('refresh')}>
              Check again
            </Button>
          </Row>
        )}
        {view?.account && (
          <Row label="Account">
            <span>{view.account}</span>
          </Row>
        )}
        {view?.tailnet && (
          <Row label="Tailnet">
            <span>{view.tailnet}</span>
          </Row>
        )}
        {!!view?.addresses.length && (
          <Row label="This device’s address">
            <span>{view.addresses.join(', ')}</span>
          </Row>
        )}
        {state === 'failed' && (
          <Row
            label={signOutIncomplete ? 'Sign out could not be completed' : 'Connection unavailable'}
            description={
              signOutIncomplete
                ? 'Retry sign out to finish local cleanup.'
                : view?.error === 'NETWORK_STORAGE_UNAVAILABLE'
                  ? 'ModelLoom could not read your saved Tailscale sign-in. Check secure credential storage, or sign out and sign in again.'
                  : 'Check your connection and secure credential storage, then try again.'
            }
          >
            <Button
              disabled={busy}
              onClick={() => void command(signOutIncomplete ? 'sign-out' : 'connect')}
            >
              {signOutIncomplete ? 'Retry sign out' : 'Reconnect'}
            </Button>
          </Row>
        )}
        {bridge && view && (
          <Row
            label="Connection"
            description={
              signIn
                ? 'Continue in your browser to sign in to your Tailscale account.'
                : 'Disconnect keeps your enrollment. Sign out removes local enrollment. You may also need to remove this device from the Tailscale admin console.'
            }
          >
            {state === 'disconnected' && (
              <Button disabled={busy} onClick={() => void command('connect')}>
                Connect to Tailscale
              </Button>
            )}
            {signIn && (
              <Button
                disabled={busy}
                onClick={() => void command(state === 'expired' ? 'connect' : 'open-login')}
              >
                {state === 'expired' ? 'Sign in again' : 'Open browser to sign in'}
              </Button>
            )}
            {(active || state === 'connected') && (
              <Button disabled={busy} onClick={() => void command('disconnect')}>
                {active ? 'Cancel' : 'Disconnect'}
              </Button>
            )}
            <Button disabled={busy} onClick={() => void command('sign-out')}>
              Sign out
            </Button>
          </Row>
        )}
        {error && (
          <Row
            label="Network information unavailable"
            description="Your last available details are shown. Try again to refresh them."
          >
            <div role="alert">
              <Button disabled={busy} onClick={() => void command('read')}>
                Retry
              </Button>
            </div>
          </Row>
        )}
      </Section>
      <Section title="Local network">
        <Row
          label="Connect manually"
          description="Manual LAN/IP connections remain available without signing in to Tailscale."
        >
          {onConnections && <Button onClick={onConnections}>Open Connections</Button>}
        </Row>
      </Section>
      <Section title="API access">
        <Row label="Local API" description="Manage API access separately from device pairing.">
          <Button onClick={onApi}>Open API settings</Button>
        </Row>
      </Section>
    </>
  );
}
