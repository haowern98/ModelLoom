import path from 'node:path';
import { mkdirSync } from 'node:fs';

// These select test artifacts only. Product activation has no environment switch.
export const developmentPackage = path.resolve(
  process.env.MODELLOOM_PACKAGED_TEST_ROOT ??
    path.join(__dirname, '../out/development/ModelLoom Development-win32-x64'),
);
export const packagedEvidence = path.resolve(
  process.env.MODELLOOM_PACKAGED_EVIDENCE_ROOT ??
    path.join(__dirname, '../out/packaged-runtime-evidence'),
);
mkdirSync(packagedEvidence, { recursive: true });
