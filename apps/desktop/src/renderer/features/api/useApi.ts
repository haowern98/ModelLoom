import { useEffect, useRef, useState } from 'react';
import { decodeApiManagementReply } from '../../../shared/local-api';
import type { ApiManagementCommand, ApiManagementStatus } from '../../../shared/local-api';
const messages: Record<string, string> = {
  CREDENTIAL_UNAVAILABLE: 'Windows could not protect or recover the API key.',
  ADDRESS_UNAVAILABLE: 'The configured port is unavailable. Stop the other service and try again.',
  RUNTIME_RECOVERY_REQUIRED:
    'API cancellation could not be confirmed. The shared model needs recovery; stop it before retrying.',
  CONFIGURATION_UNAVAILABLE: 'Local configuration storage is unavailable.',
  API_UNAVAILABLE: 'The local API is unavailable in this build.',
  NOT_READY: 'The local API is not ready.',
};
/** Page-local presentation only. Secrets never enter application state, persistence or snippets. */
export function useApi() {
  const [status, setStatus] = useState<ApiManagementStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState<ApiManagementCommand['action'] | null>(null);
  const alive = useRef(false),
    lifetime = useRef(0),
    secretEpoch = useRef(0),
    stateEpoch = useRef(0),
    focused = useRef(true),
    busy = useRef(false);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mask = () => {
    secretEpoch.current++;
    clearTimeout(expiry.current);
    setSecret(null);
  };
  useEffect(() => {
    alive.current = true;
    const current = ++lifetime.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidateSecret = () => {
      secretEpoch.current++;
      clearTimeout(expiry.current);
    };
    const blur = () => {
      focused.current = false;
      invalidateSecret();
      setSecret(null);
    };
    const focus = () => {
      focused.current = true;
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') blur();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    const poll = async () => {
      const version = stateEpoch.current;
      try {
        if (busy.current || !window.modelLoomApi) return;
        const reply = decodeApiManagementReply(
          await window.modelLoomApi.command({ action: 'status' }),
        );
        if (!alive.current || lifetime.current !== current || version !== stateEpoch.current)
          return;
        if (!reply.ok) throw new Error(reply.error);
        setStatus(reply.status);
      } catch (error) {
        if (alive.current && lifetime.current === current && version === stateEpoch.current) {
          setStatus(null);
          secretEpoch.current++;
          setSecret(null);
          setNotice(
            messages[error instanceof Error ? error.message : ''] ??
              'The local API connection failed.',
          );
        }
      } finally {
        if (alive.current && lifetime.current === current)
          timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      alive.current = false;
      lifetime.current = current + 1;
      invalidateSecret();
      clearTimeout(timer);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const command = async (action: ApiManagementCommand['action']): Promise<void> => {
    if (busy.current || !window.modelLoomApi) return;
    if (action !== 'revealKey') mask();
    const current = lifetime.current,
      epoch = secretEpoch.current;
    stateEpoch.current++;
    busy.current = true;
    setPending(action);
    setNotice('');
    try {
      const reply = decodeApiManagementReply(
        await window.modelLoomApi.command({ action }),
        action === 'revealKey',
      );
      if (!alive.current || lifetime.current !== current) return;
      if (!reply.ok) throw new Error(reply.error);
      setStatus(reply.status);
      if (action === 'revealKey') {
        if (reply.secret && secretEpoch.current === epoch && focused.current) {
          setSecret(reply.secret);
          clearTimeout(expiry.current);
          expiry.current = setTimeout(() => {
            secretEpoch.current++;
            setSecret(null);
          }, 30000);
        }
      } else if (action === 'generateKey') setNotice('API key created');
      else if (action === 'copyKey') setNotice('API key copied');
      else if (action === 'clearLogs') setNotice('Server logs cleared');
    } catch (error) {
      if (alive.current && lifetime.current === current)
        setNotice(
          messages[error instanceof Error ? error.message : ''] ?? 'The API operation failed.',
        );
    } finally {
      busy.current = false;
      if (alive.current && lifetime.current === current) setPending(null);
    }
  };
  return { status, notice, setNotice, secret, pending, mask, command };
}
