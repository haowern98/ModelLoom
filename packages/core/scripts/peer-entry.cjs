const { pathToFileURL } = require('node:url');
const path = require('node:path');
// Fixed parent-only entry. No network message can launch or configure this host.
import(pathToFileURL(path.join(__dirname, '../out/peers/utility.js')).href)
  .then(({ runPeerUtility }) =>
    runPeerUtility({
      send: (text) => process.parentPort.postMessage(text),
      receive: (handler) => process.parentPort.on('message', (event) => handler(event.data)),
      exit: (code) => process.exit(code),
    }),
  )
  .catch(() => {
    console.error('Peer core startup failed');
    process.exit(1);
  });
