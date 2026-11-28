import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

export const pin = '4f31296a907d73f3409f720429bcf31111615d77';
const core = fileURLToPath(new URL('../', import.meta.url));
export const output = path.join(core, 'out/exact-checkpoints');
export const source = path.join(output, `llama.cpp-${pin}`);
const archive = path.join(core, 'out/tensor-cache-source/source.tar.gz');
if (
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex') !== 'acbc1be00cc17559164f635af6d69df4798b64c2f6504fc90da58cf4f3b80f3b'
)
  throw Error('SOURCE_MISMATCH');
await mkdir(output, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', output], { windowsHide: true, stdio: 'inherit' });
async function patch(file, replacements) {
  let text = await readFile(path.join(source, file), 'utf8');
  for (const [before, after, count = 1] of replacements) {
    if (text.split(before).length - 1 !== count)
      throw Error(`PATCH_CONTEXT_MISMATCH ${file}: ${before.slice(0, 90)}`);
    text = text.replaceAll(before, after);
  }
  await writeFile(path.join(source, file), text);
}
await patch('common/common.h', [
  ['#include "llama.h"', '#include "llama.h"\n#include "exact-checkpoint-api.h"'],
  [
    '    std::vector<uint8_t> data_dft;',
    '    std::vector<uint8_t> data_dft;\n    std::shared_ptr<modelloom_checkpoint> device_tgt;\n    std::shared_ptr<modelloom_checkpoint> device_dft;\n    void update_tgt_device(llama_context * ctx, llama_seq_id seq_id);\n    void update_dft_device(llama_context * ctx, llama_seq_id seq_id);',
  ],
]);
await patch('common/common.cpp', [
  [
    'common_init_result::~common_init_result() = default;',
    'common_init_result::~common_init_result() { modelloom_checkpoint_release_context(context()); }',
  ],
  [
    '    return data_tgt.size() + data_dft.size() + data_spec.size();',
    '    return data_tgt.size() + data_dft.size() + data_spec.size() + modelloom_checkpoint_bytes(device_tgt.get()) + modelloom_checkpoint_bytes(device_dft.get());',
  ],
  ['    return data_tgt.empty();', '    return data_tgt.empty() && !device_tgt;'],
  ['    data_tgt.clear();', '    device_tgt.reset();\n    data_tgt.clear();', 2],
  ['    data_dft.clear();', '    device_dft.reset();\n    data_dft.clear();', 2],
  [
    'void common_prompt_checkpoint::update_tgt(\n        llama_context * ctx,\n        llama_seq_id seq_id,\n        llama_state_seq_flags flags) {',
    'void common_prompt_checkpoint::update_tgt(\n        llama_context * ctx,\n        llama_seq_id seq_id,\n        llama_state_seq_flags flags) {\n    device_tgt.reset();',
  ],
  [
    'void common_prompt_checkpoint::update_dft(\n        llama_context * ctx,\n        llama_seq_id seq_id,\n        llama_state_seq_flags flags) {',
    'void common_prompt_checkpoint::update_dft(\n        llama_context * ctx,\n        llama_seq_id seq_id,\n        llama_state_seq_flags flags) {\n    device_dft.reset();',
  ],
  [
    '    if (data_tgt.empty()) {',
    '    if (device_tgt) {\n        if (!modelloom_checkpoint_restore(ctx, seq_id, device_tgt.get())) GGML_ABORT("exact target checkpoint restore failed");\n        return;\n    }\n    if (data_tgt.empty()) {',
  ],
  [
    '    if (data_dft.empty()) {',
    '    if (device_dft) {\n        if (!modelloom_checkpoint_restore(ctx, seq_id, device_dft.get())) GGML_ABORT("exact draft checkpoint restore failed");\n        return;\n    }\n    if (data_dft.empty()) {',
  ],
]);
await writeFile(
  path.join(source, 'common/common.cpp'),
  `
void common_prompt_checkpoint::update_tgt_device(llama_context * ctx, llama_seq_id seq_id) {
    device_tgt.reset();
    if (ctx) device_tgt = {modelloom_checkpoint_create(ctx, seq_id), modelloom_checkpoint_free};
    if (device_tgt) data_tgt.clear();
    else update_tgt(ctx, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
}
void common_prompt_checkpoint::update_dft_device(llama_context * ctx, llama_seq_id seq_id) {
    device_dft.reset();
    if (ctx) device_dft = {modelloom_checkpoint_create(ctx, seq_id), modelloom_checkpoint_free};
    if (device_dft) data_dft.clear();
    else update_dft(ctx, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
}
`,
  { flag: 'a' },
);
await patch('tools/server/server-context.cpp', [
  [
    '    void destroy() {\n        spec.reset();',
    '    void destroy() {\n        modelloom_checkpoint_release_context(ctx_tgt);\n        modelloom_checkpoint_release_context(ctx_dft);\n        spec.reset();',
  ],
  [
    '        cur.update_tgt(ctx_tgt, slot.id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);',
    '        cur.update_tgt_device(ctx_tgt, slot.id);',
  ],
  [
    '        cur.update_dft(ctx_dft, slot.id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);',
    '        cur.update_dft_device(ctx_dft, slot.id);',
  ],
]);
console.log('Patched independent checkpoints; prompt batch boundaries unchanged');
