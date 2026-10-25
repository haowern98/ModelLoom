import { spawn } from 'node:child_process';
import { readFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { TailscaleHelper } from './helper.js';
import type { HelperEvents } from './helper.js';
import { NetworkOwner } from './owner.js';
import { openNetworkStore } from './store.js';
import type { NetworkProtection, NetworkStore } from './store.js';
import { probeNetworkPeer } from './http.js';

interface Options {
  executable: string;
  directory: string;
  protection: NetworkProtection;
  makePrivate?(directory: string): void;
  openLogin(url: string): Promise<void>;
}
interface Session {
  helper: TailscaleHelper;
  store: NetworkStore;
  dead: boolean;
  dispose(): Promise<void>;
}
/** The inert helper holds the OS lease before any enrollment is loaded. Disconnect
 * stops tsnet; only application shutdown releases the helper and storage lease. */
export function createDesktopNetwork(options: Options): NetworkOwner & { resume(): Promise<void> } {
  let opening: Promise<Session> | undefined, session: Session | undefined;
  let receiver: HelperEvents | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let initialCleanup: (() => Promise<void>) | undefined;
  const getSession = async (forgetUnreadable = false): Promise<Session> => {
    if (closed) throw Error('NETWORK_NOT_READY');
    if (!opening && initialCleanup) {
      await initialCleanup();
      initialCleanup = undefined;
    }
    if (session?.dead) {
      await session.dispose();
      session = undefined;
      opening = undefined;
    }
    return (opening ??= (async () => {
      await verifyComponent(options.executable);
      if (!options.protection.available()) throw Error('NETWORK_STORAGE_UNAVAILABLE');
      const requested = path.resolve(options.directory);
      await mkdir(requested, { recursive: true, mode: 0o700 });
      const directory = await lstat(requested);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw Error('NETWORK_STORAGE_UNAVAILABLE');
      // Windows application virtualization can redirect an ordinary AppData
      // directory. Bind the helper and protected-state domain to its real path.
      const root = await realpath(requested);
      options.makePrivate?.(root);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(?:TS_|TSNET_|TAILSCALE_)/iu.test(key)),
      );
      const child = spawn(options.executable, [root], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      let dead = false;
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => {
          dead = true;
          if (session) session.dead = true;
          resolve();
        });
        child.once('error', () => {
          dead = true;
          resolve();
        });
      });
      let state: NetworkStore | undefined;
      const requireState = () => {
        if (!state || dead) throw Error('NETWORK_STORAGE_UNAVAILABLE');
        return state;
      };
      const helper = new TailscaleHelper(
        child,
        {
          read: (key) => requireState().read(key),
          write: (key, bytes) => requireState().write(key, bytes),
        },
        {
          status: (view, peers) => receiver?.status(view, peers),
          login: (url) => receiver?.login(url),
          incoming: (port, stream) => {
            if (receiver) receiver.incoming(port, stream);
            else stream.destroy();
          },
          lost: () => {
            dead = true;
            if (session) session.dead = true;
            receiver?.lost();
          },
        },
      );
      let disposing: Promise<void> | undefined;
      const dispose = () =>
        (disposing ??= (async () => {
          // Retain even a helper that failed before enrollment opened. Pipe
          // failure cannot prove exit or permit another owner of its storage.
          await helper.close().catch(() => undefined);
          await deadline(exited, 5000);
          await state?.close();
        })().catch((error) => {
          disposing = undefined;
          throw error;
        }));
      initialCleanup = dispose;
      try {
        await deadline(helper.ready(), 5000);
        if (dead || closed) throw Error('NETWORK_COMPONENT_FAILED');
        // ready proves that this exact child holds owner.lock. Never cache an
        // enrollment loaded before that lease, even for a read-only resume check.
        state = await openNetworkStore(
          root,
          options.protection,
          options.makePrivate ? (directory) => options.makePrivate!(directory) : undefined,
          {
            // Only explicit Sign out may replace an unreadable enrollment. The
            // verified child already holds its lease; clear still encrypts and
            // atomically commits through that child before any reconnect.
            read: () => (forgetUnreadable ? Promise.resolve(undefined) : helper.readCiphertext()),
            replace: (bytes) => helper.replaceCiphertext(bytes),
          },
        );
        const owned: Session = {
          helper,
          store: {
            read: (key) => requireState().read(key),
            write: (key, bytes) => requireState().write(key, bytes),
            clear: () => requireState().clear(),
            close: () => Promise.resolve(),
          },
          dead,
          dispose,
        };
        session = owned;
        initialCleanup = undefined;
        return owned;
      } catch (error) {
        await dispose();
        initialCleanup = undefined;
        throw error;
      }
    })().catch((error) => {
      opening = undefined;
      throw error;
    }));
  };
  const owner: NetworkOwner = new NetworkOwner({
    openLogin: (url) => options.openLogin(url),
    rememberEnabled: async (enabled) => {
      if (enabled || opening)
        await (
          await getSession()
        ).store.write('modelloom:enabled', Buffer.from(enabled ? '1' : '0'));
    },
    forgetEnrollment: async () => {
      try {
        await lstat(path.join(options.directory, 'enrollment.bin'));
      } catch {
        return;
      }
      const owned = await getSession(true);
      try {
        await owned.store.clear();
      } catch (error) {
        // Never retain an empty reset view after a failed atomic replacement.
        owned.dead = true;
        await owned.dispose();
        throw error;
      }
    },
    probe: (address, signal) =>
      probeNetworkPeer(
        (address, port, signal) => owner.dial(address, port, signal),
        address,
        signal,
      ),
    open: async (events) => {
      const owned = await getSession();
      receiver = events;
      return {
        command: owned.helper.command.bind(owned.helper),
        dial: owned.helper.dial.bind(owned.helper),
        async close() {
          if (receiver === events) receiver = undefined;
          if (!owned.dead) await owned.helper.command('disconnect');
        },
      };
    },
  });
  const close = owner.close.bind(owner);
  return Object.assign(owner, {
    async resume() {
      try {
        await lstat(path.join(options.directory, 'enrollment.bin'));
      } catch {
        return;
      }
      try {
        if ((await (await getSession()).store.read('modelloom:enabled'))?.toString() === '1')
          await owner.command({ action: 'connect' });
      } catch {
        await owner.command({ action: 'connect' });
      }
    },
    close() {
      return (closing ??= (async () => {
        try {
          await close();
        } finally {
          closed = true;
          receiver = undefined;
          try {
            if (opening) await (await opening).dispose();
          } finally {
            if (initialCleanup) {
              await initialCleanup();
              initialCleanup = undefined;
            }
          }
        }
      })().catch((error) => {
        closing = undefined;
        throw error;
      }));
    },
  });
}
async function verifyComponent(executable: string): Promise<void> {
  const stat = await lstat(executable).catch(() => {
    throw Error('NETWORK_COMPONENT_MISSING');
  });
  const manifest = path.join(path.dirname(executable), 'manifest.json');
  const metadataStat = await lstat(manifest).catch(() => {
    throw Error('NETWORK_COMPONENT_INVALID');
  });
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 128 * 1024 * 1024 ||
    !metadataStat.isFile() ||
    metadataStat.isSymbolicLink() ||
    metadataStat.size > 16384
  )
    throw Error('NETWORK_COMPONENT_INVALID');
  const metadata = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
  const digest = createHash('sha256')
    .update(await readFile(executable))
    .digest('hex');
  const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  if (
    metadata.sha256 !== digest ||
    metadata.protocol !== 1 ||
    metadata.target !== target ||
    metadata.tailscaleVersion !== '1.104.2' ||
    metadata.goVersion !== '1.27.3'
  )
    throw Error('NETWORK_COMPONENT_INVALID');
}
function deadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('NETWORK_TIMEOUT')), milliseconds);
    void work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : Error('NETWORK_UNAVAILABLE'));
      },
    );
  });
}
