import { expect, it, vi } from 'vitest';
import { VerifiedRpcBackend } from './verified-rpc.js';

it('rejects a serialized installation before launching anything', async () => {
  const backend = new VerifiedRpcBackend(() =>
    Promise.resolve({
      packageId: 'llama-cuda-development',
      directory: 'E:\\forged',
    }),
  );
  await expect(backend.openSharing(['GPU-13888736-7373-258e-4c34-7c64696954cd'])).rejects.toThrow(
    'UNVERIFIED_PACKAGE',
  );
  await expect(backend.closeSharing()).resolves.toBeUndefined();
});
it('rejects unsupported or multiple selections before package access', async () => {
  const install = vi.fn();
  const backend = new VerifiedRpcBackend(install);
  await expect(backend.start(['CUDA0'])).rejects.toThrow('INVALID_GPU_RESERVATION');
  await expect(backend.start([])).rejects.toThrow('INVALID_GPU_RESERVATION');
  expect(install).not.toHaveBeenCalled();
});
