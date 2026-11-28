import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

const core = fileURLToPath(new URL('../', import.meta.url));
const pin = 'llama.cpp-4f31296a907d73f3409f720429bcf31111615d77';
const reference = path.join(core, 'out/tensor-cache-source', pin);
const candidate = path.join(core, 'out/exact-checkpoints', pin);

test('model graph, context implementation and kernels remain untouched', async () => {
  for (const folder of ['src', 'src/models']) {
    for (const name of await readdir(path.join(reference, folder))) {
      if (!/\.(?:h|cpp)$/u.test(name)) continue;
      const file = path.join(folder, name);
      assert.deepEqual(
        await readFile(path.join(candidate, file)),
        await readFile(path.join(reference, file)),
        file,
      );
    }
  }
});

test('prompt batch construction and checkpoint scheduling stay byte-for-byte unchanged', async () => {
  const file = 'tools/server/server-context.cpp';
  const before = await readFile(path.join(reference, file), 'utf8');
  const after = await readFile(path.join(candidate, file), 'utf8');
  // Storage selection and early teardown are the only allowed edits in this file.
  const normalized = after
    .replace(
      '        cur.update_tgt_device(ctx_tgt, slot.id);',
      '        cur.update_tgt(ctx_tgt, slot.id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);',
    )
    .replace(
      '        cur.update_dft_device(ctx_dft, slot.id);',
      '        cur.update_dft(ctx_dft, slot.id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);',
    )
    .replace(
      '        modelloom_checkpoint_release_context(ctx_tgt);\n        modelloom_checkpoint_release_context(ctx_dft);\n',
      '',
    );
  assert.equal(normalized, before);
});
