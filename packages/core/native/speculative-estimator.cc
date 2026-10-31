// Runs only metadata/no-allocation graph planning in a separate process.
#include "arg.h"
#include "common.h"
#include "ggml-backend.h"
#include "llama-ext.h"
#include "nlohmann/json.hpp"
#include "sampling.h"
#include "speculative.h"
#include <algorithm>
#include <cstdio>
#include <map>
#include <stdexcept>
#include <string>

extern "C" __declspec(dllimport) size_t
modelloom_estimator_reserve(llama_context *ctx);
using json = nlohmann::ordered_json;
struct parts {
  size_t model = 0, context = 0, compute = 0;
};
static constexpr const char *pin = "4f31296a907d73f3409f720429bcf31111615d77";

static void add(std::map<std::string, parts> &result, llama_context *ctx,
                bool shared_model) {
  for (const auto &item : llama_get_memory_breakdown(ctx)) {
    auto buft = item.first;
    std::string device = "Host";
    if (!ggml_backend_buft_is_host(buft)) {
      auto dev = ggml_backend_buft_get_device(buft);
      if (!dev)
        throw std::runtime_error("ESTIMATOR_UNKNOWN_BUFFER_DEVICE");
      if (ggml_backend_dev_type(dev) != GGML_BACKEND_DEVICE_TYPE_CPU)
        device = ggml_backend_dev_name(dev);
    }
    auto &row = result[device];
    if (!shared_model)
      row.model += item.second.model;
    row.context += item.second.context;
    row.compute += item.second.compute;
  }
}

static void validate_head(common_speculative_type type,
                          const llama_model *target, const llama_model *draft) {
  if (type == COMMON_SPECULATIVE_TYPE_DRAFT_MTP) {
    if (llama_model_n_layer_nextn(draft) < 1 ||
        llama_model_n_embd_out(draft) != llama_model_n_embd_out(target))
      throw std::runtime_error("INCOMPATIBLE_MTP_HEAD");
  }
  if (type == COMMON_SPECULATIVE_TYPE_DRAFT_EAGLE3 ||
      type == COMMON_SPECULATIVE_TYPE_DRAFT_DFLASH ||
      type == COMMON_SPECULATIVE_TYPE_DRAFT_DSPARK) {
    const auto count = llama_model_target_layer_ids_n(draft);
    if (!count || (type == COMMON_SPECULATIVE_TYPE_DRAFT_EAGLE3 && count != 3))
      throw std::runtime_error("INCOMPATIBLE_EXTRACT_LAYERS");
    const auto ids = llama_model_target_layer_ids(draft);
    for (uint32_t i = 0; i < count; ++i)
      if (ids[i] < 0 || ids[i] > llama_model_n_layer(target))
        throw std::runtime_error("INCOMPATIBLE_EXTRACT_LAYER_RANGE");
  }
}

int main(int argc, char **argv) {
  try {
    common_params p;
    common_init();
    if (!common_params_parse(argc, argv, p, LLAMA_EXAMPLE_SERVER))
      return 2;
    p.speculative.types.erase(std::remove(p.speculative.types.begin(),
                                          p.speculative.types.end(),
                                          COMMON_SPECULATIVE_TYPE_NONE),
                              p.speculative.types.end());
    const auto neural = [](common_speculative_type type) {
      return type >= COMMON_SPECULATIVE_TYPE_DRAFT_SIMPLE &&
             type <= COMMON_SPECULATIVE_TYPE_DRAFT_DSPARK;
    };
    const auto neural_count = std::count_if(p.speculative.types.begin(),
                                            p.speculative.types.end(), neural);
    if (p.speculative.types.empty() || p.speculative.types.size() > 2 ||
        neural_count > 1 || p.speculative.types.size() - neural_count > 1 ||
        p.n_ctx <= 0 || p.n_parallel <= 0 || p.speculative.has_synth())
      throw std::runtime_error(
          "ESTIMATOR_REQUIRES_ONE_NEURAL_PLUS_ONE_RETRIEVAL_AND_FIXED_CONTEXT");
    const auto neural_it = std::find_if(p.speculative.types.begin(),
                                        p.speculative.types.end(), neural);
    const auto type = neural_it == p.speculative.types.end()
                          ? p.speculative.types.front()
                          : *neural_it;
    const auto has = [&](common_speculative_type t) {
      return std::find(p.speculative.types.begin(), p.speculative.types.end(),
                       t) != p.speculative.types.end();
    };
    // These maps retain observations beyond one bounded context across
    // requests.
    if (has(COMMON_SPECULATIVE_TYPE_NGRAM_CACHE) ||
        has(COMMON_SPECULATIVE_TYPE_NGRAM_MAP_K) ||
        has(COMMON_SPECULATIVE_TYPE_NGRAM_MAP_K4V))
      throw std::runtime_error("UNBOUNDED_NATIVE_RETRIEVAL_STATE");
    p.no_alloc = true;
    p.load_mode = LLAMA_LOAD_MODE_NONE;
    p.fit_params = false;
    p.warmup = false;
    const auto limits = common_speculative_get_output_limits(
        p.n_batch, p.n_parallel, common_speculative_n_max(&p.speculative));
    p.n_outputs_max = std::max(1, limits.total);
    p.n_outputs_max_per_seq = std::max(1, limits.per_seq);
    llama_backend_init();
    auto mp = common_model_params_to_llama(p);
    mp.no_alloc = true;
    mp.load_mode = LLAMA_LOAD_MODE_NONE;
    auto cp = common_context_params_to_llama(p);
    llama_model_ptr target(
        llama_model_load_from_file(p.model.path.c_str(), mp));
    if (!target)
      throw std::runtime_error("TARGET_METADATA_LOAD_FAILED");
    std::vector<common_sampler_ptr> target_samplers;
    std::vector<llama_sampler_seq_config> sampler_config;
    for (int i = 0; i < p.n_parallel; ++i) {
      target_samplers.emplace_back(
          common_sampler_init(target.get(), p.sampling));
      sampler_config.push_back(
          {i, common_sampler_get(target_samplers.back().get())});
    }
    if (p.sampling.backend_sampling) {
      cp.samplers = sampler_config.data();
      cp.n_samplers = sampler_config.size();
    }
    llama_context_ptr ctx(llama_init_from_model(target.get(), cp));
    if (!ctx)
      throw std::runtime_error("TARGET_CONTEXT_PLAN_FAILED");
    common_speculative_init_result_ptr draft;
    const bool needs_draft =
        p.speculative.has_dft() || type == COMMON_SPECULATIVE_TYPE_DRAFT_MTP;
    if (needs_draft) {
      auto dp = common_base_params_to_speculative(p);
      dp.no_alloc = true;
      draft = common_speculative_init_from_params(dp, target.get(), ctx.get());
      if (!draft || !draft->context() ||
          (p.speculative.has_dft() && !draft->model()))
        throw std::runtime_error("DRAFT_CONTEXT_PLAN_FAILED");
      validate_head(type, target.get(),
                    draft->model() ? draft->model() : target.get());
      p.speculative.draft.ctx_tgt = ctx.get();
      p.speculative.draft.ctx_dft = draft->context();
    }
    common_speculative_ptr spec(
        common_speculative_init(p.speculative, p.n_parallel));
    if (!spec)
      throw std::runtime_error("SPECULATIVE_INIT_FAILED");
    size_t host_extra = modelloom_estimator_reserve(ctx.get());
    std::map<std::string, parts> result;
    for (auto dev : p.devices)
      if (dev && ggml_backend_dev_type(dev) != GGML_BACKEND_DEVICE_TYPE_CPU)
        result[ggml_backend_dev_name(dev)];
    for (auto dev : p.speculative.draft.devices)
      if (dev && ggml_backend_dev_type(dev) != GGML_BACKEND_DEVICE_TYPE_CPU)
        result[ggml_backend_dev_name(dev)];
    add(result, ctx.get(), false);
    if (draft) {
      host_extra += modelloom_estimator_reserve(draft->context());
      add(result, draft->context(), !draft->model());
      const auto dm = draft->model() ? draft->model() : target.get();
      const size_t batch = p.n_batch, seqs = p.n_parallel,
                   width = llama_model_n_embd_out(dm);
      const size_t layers = llama_model_target_layer_ids_n(dm);
      // Source-sized float workspaces: gathered features, encoder outputs,
      // per-sequence verification rows, deferred boundaries and MTP chains.
      // Each slot can retain its largest previous verification buffer;
      // MSVC vector growth is below twice the requested element count.
      host_extra +=
          2 * sizeof(float) *
          (batch * (layers * llama_model_n_embd(target.get()) + width) +
           seqs * (batch + size_t(p.speculative.draft.n_max) + 2) * width);
    }
    if (has(COMMON_SPECULATIVE_TYPE_NGRAM_MOD))
      host_extra += 4ull * 1024 * 1024 * sizeof(int32_t);
    // The owner's existing host envelope remains responsible for allocator,
    // token history, JSON, sampler and model-metadata overhead.
    result["Host"].compute += host_extra;
    json metadata = {
        {"version", 1},
        {"method", common_speculative_type_name_str(p.speculative.types)},
        {"initialized", true},
        {"sourceCommit", pin},
        {"hostExtraBytes", host_extra},
        {"hostBounded", true},
        {"targetLayers", llama_model_n_layer(target.get())},
        {"targetHidden", llama_model_n_embd(target.get())},
        {"targetContext", llama_n_ctx(ctx.get())},
        {"targetVocab",
         llama_vocab_n_tokens(llama_model_get_vocab(target.get()))}};
    printf("MODELLOOM_SPEC_ESTIMATE %s\n", metadata.dump().c_str());
    const auto print = [&](const std::string &name) {
      const auto row = result[name];
      constexpr size_t mib = 1024 * 1024;
      printf("%s %zu %zu %zu\n", name.c_str(), (row.model + mib - 1) / mib,
             (row.context + mib - 1) / mib, (row.compute + mib - 1) / mib);
    };
    // Enumeration order matches the process visibility/RPC registration order.
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
      const std::string name = ggml_backend_dev_name(ggml_backend_dev_get(i));
      if (result.count(name))
        print(name);
    }
    print("Host");
    return 0;
  } catch (const std::exception &error) {
    fprintf(stderr, "MODELLOOM_SPEC_ESTIMATE_FAILED %s\n", error.what());
    return 1;
  }
}
