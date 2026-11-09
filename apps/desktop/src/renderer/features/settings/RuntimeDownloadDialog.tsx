import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import type { RuntimeManagement } from './SettingsPage';

type Offers = Awaited<ReturnType<RuntimeManagement['checkForUpdates']>>;

export function RuntimeDownloadDialog({
  management,
  firstLaunch,
  installed,
  onInstalled,
  onSelected,
  onClose,
}: {
  management: RuntimeManagement;
  firstLaunch?: boolean;
  installed: RuntimeManagement['installed'];
  onInstalled: (installed: RuntimeManagement['installed']) => void;
  onSelected?: (selected: Offers[number]['build']) => void;
  onClose: () => void;
}) {
  const [offers, setOffers] = useState<Offers>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void management.checkForUpdates().then(
      (result) => {
        if (current) setOffers(result.filter(({ build }) => build.backend !== 'cpu'));
      },
      () => {
        if (current) setError('Could not load runtime downloads. Try again.');
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, management]);

  async function download(build: Offers[number]['build']) {
    setBusy(true);
    setError('');
    setProgress('Downloading runtime…');
    let installed: RuntimeManagement['installed'];
    try {
      installed = await management.install(build, setProgress);
    } catch {
      setError('Could not install this runtime. Try again.');
      return;
    } finally {
      setBusy(false);
      setProgress('');
    }
    onInstalled(installed);
    if (firstLaunch) await select(build);
    else setProgress('Runtime installed.');
  }

  async function select(build: Offers[number]['build']) {
    setBusy(true);
    setError('');
    try {
      const selected = await management.select(build);
      onSelected?.(selected);
      onClose();
    } catch {
      setError('Runtime installed. Could not select it. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={firstLaunch ? 'Set up a runtime' : 'Download runtimes'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {firstLaunch
          ? 'Choose CUDA or Vulkan to load GGUF models.'
          : 'Install another runtime and select it in Settings.'}
      </p>
      {offers === undefined && !error && <p role="status">Checking available runtimes…</p>}
      {offers?.length === 0 && <p>No runtime downloads available.</p>}
      {offers?.map(({ build, size }) => {
        const name = build.backend === 'cuda' ? 'CUDA' : 'Vulkan';
        const isInstalled = installed.some(
          (item) =>
            item.packageId === build.packageId &&
            item.version === build.version &&
            item.artifact === build.artifact &&
            item.upstreamCommit === build.upstreamCommit,
        );
        return (
          <p key={`${build.packageId}:${build.version}:${build.artifact}:${build.upstreamCommit}`}>
            {name} · {build.version} · {size}{' '}
            {isInstalled ? (
              firstLaunch ? (
                <Button disabled={busy} onClick={() => void select(build)}>
                  Use {name}
                </Button>
              ) : (
                'Installed'
              )
            ) : (
              <Button disabled={busy} onClick={() => void download(build)}>
                Download {name}
              </Button>
            )}
          </p>
        );
      })}
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      {error && offers === undefined && (
        <Button
          onClick={() => {
            setError('');
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      )}
      <footer>
        <Button disabled={busy} onClick={onClose}>
          {firstLaunch ? 'Set up later' : 'Done'}
        </Button>
      </footer>
    </Dialog>
  );
}
