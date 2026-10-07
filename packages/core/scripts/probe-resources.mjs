import { discoverResources } from '../out/hosts/resource-probe.js';

// Development diagnostic only: no engine, admission authority, listener or model load.
if (process.argv.length !== 2) throw new Error('Unknown resource diagnostic option');
const snapshot = await discoverResources();
console.log(JSON.stringify({ sampleOnly: true, ...snapshot }, null, 2));
if (snapshot.ram === null || snapshot.gpuQuery !== 'OK') process.exitCode = 1;
