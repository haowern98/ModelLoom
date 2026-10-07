const { pathToFileURL } = require('node:url');
const path = require('node:path');
import(pathToFileURL(path.join(__dirname, '../out/hosts/utility.js')).href)
  .then(({ runUtility }) => {
    runUtility({
      send: (text) => process.parentPort.postMessage(text),
      receive: (handler) => process.parentPort.on('message', (event) => handler(event.data)),
      exit: (code) => process.exit(code),
    });
  })
  .catch((error) => {
    console.error('Fixture utility startup failed:', error);
    process.exit(1);
  });
