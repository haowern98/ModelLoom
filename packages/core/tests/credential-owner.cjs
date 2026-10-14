// Harmless parent-death fixture. Reports process identities and pipe name only.
const native = require('../out/native/ownership.node');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setInterval } = require('node:timers');
const directory = path.resolve(__dirname, '../out/native');
const root = native.createDeployment();
const credential = native.createCredential(root, randomUUID(), 'A'.repeat(43));
const pipe = native.credentialPath(credential);
const fixture = path.join(directory, 'console-fixture.exe');
const child = native.launchConsole(
  root,
  path.join(directory, 'ModelLoom-runtime-host.exe'),
  [fixture, 'credential', pipe],
  directory,
);
let text = '',
  captured = false,
  delivered = false,
  reported = false;
const mode = process.argv[2];
setInterval(() => {
  const observation = native.observe(child);
  text += observation.output;
  const receipt = /^ENGINE ([0-9]+)/mu.exec(text);
  if (receipt && !captured) {
    native.captureServer(child, Number(receipt[1]), fixture);
    captured = true;
  }
  if (captured && mode === 'ready' && !delivered)
    delivered = native.deliverCredential(credential, child);
  if (!reported && captured && (mode !== 'ready' || text.includes('CREDENTIAL RECEIVED'))) {
    if (mode === 'ready') native.releaseCredential(credential);
    console.log(JSON.stringify({ pipe, pids: [observation.pid, Number(receipt[1])], phase: mode }));
    reported = true;
  }
}, 10);
