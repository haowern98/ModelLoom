const { app, utilityProcess } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
// No BrowserWindow, renderer, preload, app UI or production runtime is involved.
app
  .whenReady()
  .then(async () => {
    const { createDesktopFixtureHost } = await import(
      pathToFileURL(path.join(__dirname, '../out/hosts/desktop.js')).href
    );
    const host = await createDesktopFixtureHost((entry) => {
      const child = utilityProcess.fork(entry, [], {
        stdio: 'pipe',
        serviceName: 'ModelLoom core fixture',
      });
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
      return child;
    }, process.argv[2] ?? 'ready');
    const close = () => {
      void host.close().then(
        () => app.exit(0),
        () => app.exit(1),
      );
    };
    const command = (text) => {
      void host
        .command(text)
        .then(async (reply) => {
          await new Promise((resolve, reject) =>
            process.send(reply, (error) => (error ? reject(error) : resolve())),
          );
          if (reply.quit === true) app.exit(0);
        })
        .catch(close);
    };
    process.on('message', command);
    process.on('disconnect', close);
    app.on('before-quit', (event) => {
      event.preventDefault();
      close();
    });
  })
  .catch((error) => {
    console.error('Fixture host startup failed:', error);
    app.exit(1);
  });
