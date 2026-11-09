import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finalizeReleaseRoot, prepareReleaseRoot } from '../out/publisher/release-root.js';

const [operation, ...args] = process.argv.slice(2);
if (operation === 'prepare' && args.length === 3) {
  const [directory, expiry, output] = args;
  const readKey = (name) => readFile(path.join(directory, name + '.pub.pem'), 'utf8');
  const [root, targets, snapshot, timestamp] = await Promise.all([
    Promise.all(['root-1', 'root-2', 'root-3'].map(readKey)),
    readKey('targets'),
    readKey('snapshot'),
    readKey('timestamp'),
  ]);
  const signed = prepareReleaseRoot(
    { root, targets: [targets], snapshot: [snapshot], timestamp: [timestamp] },
    new Date(expiry),
  );
  await writeFile(output, signed, { flag: 'wx' });
} else if (operation === 'finalize' && args.length >= 4 && args.length <= 5) {
  const [input, output, ...signatureSpecs] = args;
  const signed = await readFile(input);
  const ids = JSON.parse(signed.toString('utf8')).roles.root.keyids;
  const signatures = new Map();
  for (const spec of signatureSpecs) {
    const match = /^([1-3])=(.+)$/.exec(spec);
    if (!match) throw new Error('Use N=signature-file for each offline root signer');
    const id = ids[Number(match[1]) - 1];
    if (signatures.has(id)) throw new Error('Duplicate root signer');
    signatures.set(id, await readFile(match[2]));
  }
  const result = finalizeReleaseRoot(signed, signatures);
  await writeFile(output, result.bytes, { flag: 'wx' });
  console.log('Public root SHA-256: ' + result.sha256);
} else {
  throw new Error(
    'Use prepare <public-key-directory> <expiry-utc> <unsigned-output> or finalize <unsigned-input> <root.json> <N=signature-file> <N=signature-file> [N=signature-file]',
  );
}
