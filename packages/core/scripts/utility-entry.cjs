const { pathToFileURL } = require('node:url');
const path = require('node:path');
// Main selects this fixed host entry. The utility has no publisher, filesystem-selection or native launch API.
import(pathToFileURL(path.join(__dirname, '../out/hosts/utility.js')).href)
  .then(({ runUtility }) =>
    runUtility({
      send: (text) => process.parentPort.postMessage(text),
      receive: (handler) => process.parentPort.on('message', (event) => handler(event.data)),
      exit: (code) => process.exit(code),
    }),
  )
  .catch(() => {
    console.error('Core utility startup failed');
    process.exit(1);
  });
