// Startup-only diagnostic. No model weights, allocations or graph execution.
// Requires the explicit --start-cuda argument and is not a desktop backend.
import { DiagnosticRpcBackend } from '../src/peers/diagnostic-rpc.ts';
if (process.argv.length !== 3 || process.argv[2] !== '--start-cuda')
  throw new Error('Explicit CUDA startup scope required');
const owned = await new DiagnosticRpcBackend('cuda').start([
  'GPU-d42a520b-020b-2673-9923-6906e674e243',
]);
try {
  console.log(JSON.stringify({ phase: 'restricted-cuda-ready' }));
} finally {
  await owned.close();
}
