const { app, utilityProcess } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
// Synthetic transport only: exercises the real utility, ownership and protected SQLite store.
app
  .whenReady()
  .then(async () => {
    const load = (file) => import(pathToFileURL(path.join(__dirname, '../out', file)).href);
    const { createDesktopEngineHost } = await load('hosts/desktop.js');
    const { createFixtureDeployment } = await load('hosts/fixture-engine.js');
    const deployment = createFixtureDeployment();
    const host = await createDesktopEngineHost(
      (entry) => {
        const child = utilityProcess.fork(entry, [], {
          stdio: 'pipe',
          serviceName: 'ModelLoom Chat fixture',
        });
        child.stderr.on('data', (chunk) => process.stderr.write(chunk));
        return child;
      },
      {
        adapter: deployment.adapter('ready'),
        children: () => deployment.children(),
        admitCore: (pid, image, time) => deployment.admitCore(pid, image, time),
        close: () => deployment.close(),
        chatSetup: {
          applicationData: process.argv[2],
          caller: 'window',
          provenance: {
            packageId: 'fixture',
            upstreamCommit: 'a'.repeat(40),
            configuration: {
              modelSha256: 'a'.repeat(64),
              slots: 4,
              contextPerSlot: 7680,
              gpuLayers: 0,
              cacheK: 'f16',
              cacheV: 'f16',
              seed: 7,
              temperature: 0.8,
            },
          },
        },
        chat: () => ({
          tokenCount: () => Promise.resolve(10),
          start(_id, _messages, progress) {
            let finish;
            const settled = new Promise((yes) => {
              finish = yes;
            });
            let cancelled = false;
            void Promise.resolve()
              .then(() => progress({ type: 'text', text: 'Synthetic saved partial' }))
              .catch(() => finish({ status: 'failed', reason: 'EXECUTION_FAILED' }));
            return {
              settled,
              cancel() {
                if (!cancelled) {
                  cancelled = true;
                  finish({ status: 'cancelled', reason: 'USER_CANCELLED' });
                }
              },
            };
          },
        }),
      },
    );
    process.on('message', (input) => {
      void (async () => {
        const reply = input.chat
          ? await host.chat('window', input.chat)
          : await host.command(JSON.stringify(input.command));
        await new Promise((yes, no) =>
          process.send({ id: input.id, reply }, (error) => (error ? no(error) : yes())),
        );
        if (reply.quit) app.exit(0);
      })().catch(() => {
        void host.close().finally(() => app.exit(1));
      });
    });
    process.on('disconnect', () => {
      void host.close().finally(() => app.exit(1));
    });
    process.send({ id: 0, reply: { ok: true } });
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
