const MiB = 1048576;
// Calibration guard only: the exact one-slot 768 MiB/two-checkpoint run already
// includes its loading peak and caches. Add only three slots' checkpoints,
// a conservative host shadow of the added GPU context, and the free-RAM guard.
// This is not a normal-loader report or a measured four-slot requirement.
export const diagnosticBudget = Object.freeze({
  ram: 4986970112 + 3 * 2 * 151 * MiB + (1619 - 405) * MiB + 1024 ** 3,
  vram: (3447 + 1619 + 513 + 512) * MiB,
});
export function admitsDiagnostic(snapshot) {
  return (
    Number.isSafeInteger(snapshot.ram) &&
    snapshot.ram >= diagnosticBudget.ram &&
    Array.isArray(snapshot.gpus) &&
    snapshot.gpus.some(
      (g) =>
        g.uuid === 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a' &&
        Number.isSafeInteger(g.free) &&
        g.free >= diagnosticBudget.vram,
    )
  );
}
