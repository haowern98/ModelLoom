#include "../../native/tensor-cache.h"
#include <cassert>
#include <chrono>
#include <fstream>
#include <iostream>
#ifdef _WIN32
#include "../../native/tensor-cache-policy.h"

void private_directory(const std::filesystem::path &path, HANDLE token) {
  DWORD length = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &length);
  std::vector<uint8_t> storage(length);
  assert(
      GetTokenInformation(token, TokenUser, storage.data(), length, &length));
  wchar_t *user = nullptr;
  assert(ConvertSidToStringSidW(
      reinterpret_cast<TOKEN_USER *>(storage.data())->User.Sid, &user));
  const std::wstring sddl =
      L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + std::wstring(user) + L")";
  LocalFree(user);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  assert(ConvertStringSecurityDescriptorToSecurityDescriptorW(
      sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr));
  PACL acl = nullptr;
  BOOL present = FALSE, defaulted = FALSE;
  assert(GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted));
  assert(SetNamedSecurityInfoW(
             const_cast<wchar_t *>(path.c_str()), SE_FILE_OBJECT,
             DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
             nullptr, nullptr, acl, nullptr) == ERROR_SUCCESS);
  LocalFree(descriptor);
}

void private_cache_test(const std::filesystem::path &base) {
  namespace fs = std::filesystem;
  using namespace modelloom::tensor_cache;
  const auto parent = base / "private-profile";
  const auto root = parent / "Downloads" / "cache";
  fs::create_directories(root);
  HANDLE original = nullptr;
  assert(OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &original));
  private_directory(parent, original);
  prepare(root);
  {
    std::ofstream private_file(parent / "private.txt");
    private_file << "outside-cache";
  }
  BYTE users[SECURITY_MAX_SID_SIZE]{}, world[SECURITY_MAX_SID_SIZE]{};
  DWORD size = sizeof(users);
  assert(CreateWellKnownSid(WinBuiltinUsersSid, nullptr, users, &size));
  size = sizeof(world);
  assert(CreateWellKnownSid(WinWorldSid, nullptr, world, &size));
  PSID cache = nullptr;
  assert(ConvertStringSidToSidW(cache_sid, &cache));
  SID_AND_ATTRIBUTES restrictions[] = {{users, 0}, {world, 0}, {cache, 0}};
  HANDLE restricted = nullptr;
  assert(CreateRestrictedToken(original, DISABLE_MAX_PRIVILEGE | LUA_TOKEN, 0,
                               nullptr, 0, nullptr, 3, restrictions,
                               &restricted));
  LocalFree(cache);
  CloseHandle(original);
  pinned_directory pinned(root);
  assert(!MoveFileExW(parent.c_str(), (base / "moved-profile").c_str(), 0));
  HANDLE directory = pinned.inherit_root();
  const auto handle = std::to_wstring(reinterpret_cast<uintptr_t>(directory));
  assert(SetEnvironmentVariableW(L"MODELLOOM_TENSOR_CACHE_ROOT_HANDLE",
                                 handle.c_str()));
  assert(ImpersonateLoggedOnUser(restricted));
  bool reused = false, private_denied = false;
  try {
    HANDLE secret =
        CreateFileW((parent / "private.txt").c_str(), GENERIC_READ,
                    FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    private_denied =
        secret == INVALID_HANDLE_VALUE && GetLastError() == ERROR_ACCESS_DENIED;
    if (secret != INVALID_HANDLE_VALUE)
      CloseHandle(secret);
    for (const auto &encoded : {L"1", L"0", L"-1", L"184467440737095516160"}) {
      SetEnvironmentVariableW(root_handle_variable, encoded);
      bool rejected = false;
      try {
        store invalid(root, 131072, 0, false);
      } catch (...) {
        rejected = true;
      }
      assert(rejected);
    }
    SetEnvironmentVariableW(root_handle_variable, handle.c_str());
    bool mismatch_rejected = false;
    try {
      store invalid(parent, 131072, 0, false);
    } catch (...) {
      mismatch_rejected = true;
    }
    assert(mismatch_rejected);
    std::vector<uint8_t> bytes(65536, 73);
    store selected(root, 131072, 0, true);
    reused =
        selected.ready() && selected.put(bytes.data(), bytes.size()) &&
        selected.get(digest(bytes.data(), bytes.size()), bytes.size()) == bytes;
  } catch (const std::exception &error) {
    std::cerr << "private cache: " << error.what() << '\n';
  }
  assert(RevertToSelf());
  CloseHandle(restricted);
  SetEnvironmentVariableW(L"MODELLOOM_TENSOR_CACHE_ROOT_HANDLE", nullptr);
  CloseHandle(directory);
  assert(private_denied);
  if (!reused)
    throw std::runtime_error("PRIVATE_CACHE_COLD_WARM_FAILED");
  std::cout << "private cache: restricted cold/warm access and private-file "
               "denial passed\n";
}
#endif

int main(int argc, char **argv) {
  assert(argc == 2);
  namespace fs = std::filesystem;
  const fs::path root = fs::u8path(argv[1]);
#ifdef _WIN32
  for (const auto &input : {std::vector<char>{1}, std::vector<char>(18, 0),
                            std::vector<char>(5000, 1)}) {
    bool denied = false;
    try {
      modelloom::apply_cache_policy(input.data(), input.size());
    } catch (...) {
      denied = true;
    }
    assert(denied);
  }
  modelloom::apply_cache_policy(nullptr, 0);
  assert(GetEnvironmentVariableW(L"MODELLOOM_TENSOR_CACHE", nullptr, 0) == 0);
#endif
  fs::create_directories(root);
  modelloom::tensor_cache::prepare(root);
#ifdef _WIN32
  private_cache_test(root / "restricted-case");
#endif
  std::vector<uint8_t> a(65536, 17), b(65536, 29), c(65536, 41);
  const auto ha = modelloom::tensor_cache::digest(a.data(), a.size());
  const auto hb = modelloom::tensor_cache::digest(b.data(), b.size());
  const auto hc = modelloom::tensor_cache::digest(c.data(), c.size());
  // Cross-check SHA-256 against an independently generated known-answer vector.
  assert(modelloom::tensor_cache::digest(
             reinterpret_cast<const uint8_t *>("abc"), 3) ==
         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  using modelloom::tensor_cache::store;
  {
    store cache(root, 131072, 0, false);
    assert(cache.get(ha, a.size()).empty());
    assert(cache.put(a.data(), a.size()));
    assert(cache.get(ha, a.size()) == a);
    assert(cache.get(ha, a.size() - 1).empty());
    assert(cache.put(b.data(), b.size()));
    assert(!cache.put(c.data(), c.size()));
    assert(cache.get(ha, a.size()) == a);
    store competing(root, 131072, 0, false);
    assert(!competing.ready());
  }
  // Force distinct ages instead of relying on filesystem timestamp resolution.
  // The following hit must promote a above b before quota-driven eviction.
  const auto now = fs::file_time_type::clock::now();
  fs::last_write_time(root / (ha + ".tensor"), now - std::chrono::hours(2));
  fs::last_write_time(root / (hb + ".tensor"), now - std::chrono::hours(1));
  {
    store cache(root, 131072, 0, true);
    assert(cache.get(ha, a.size()) == a);
    assert(cache.put(c.data(), c.size()));
    assert(cache.get(hb, b.size()).empty());
    assert(cache.get(hc, c.size()) == c);
  }
  // A modified or truncated entry is never supplied as a hit.
  {
    std::ofstream file(root / (ha + ".tensor"),
                       std::ios::binary | std::ios::trunc);
    file << "bad";
  }
  {
    store cache(root, 131072, 0, true);
    assert(cache.get(ha, a.size()).empty());
    assert(cache.put(a.data(), a.size()));
  }
  {
    std::fstream file(root / (ha + ".tensor"),
                      std::ios::binary | std::ios::in | std::ios::out);
    file.put('x');
  }
  {
    store cache(root, 131072, 0, true);
    assert(cache.get(ha, a.size()).empty());
  }
  {
    store cache(root, 131072, 0, true, std::string(64, 'a'));
    assert(cache.put(a.data(), a.size()));
    assert(cache.get(ha, a.size()) == a);
  }
  {
    store cache(root, 131072, 0, true, std::string(64, 'b'));
    assert(cache.get(ha, a.size()).empty());
  }
  {
    store cache(root, 65536, 0, true);
    if (cache.usage() > 65536) {
      std::cerr << "replacement policy did not apply a lowered cache limit\n";
      return 6;
    }
  }
  {
    std::ofstream file(root / (ha + ".partial"));
    file << "interrupted";
  }
  {
    std::ofstream file(root / "original.gguf");
    file << "preserve";
  }
  {
    store cache(root, 131072, UINT64_MAX, true);
    assert(!cache.put(a.data(), a.size()));
    assert(!fs::exists(root / (ha + ".partial")));
    cache.clear();
    assert(fs::exists(root / "original.gguf"));
    assert(cache.usage() == 8);
  }
  // The store never follows a cache entry to an unrelated original file.
  std::error_code ec;
  fs::create_symlink(root / "original.gguf", root / (ha + ".tensor"), ec);
  if (!ec) {
    store cache(root, 131072, 0, true);
    assert(cache.get(ha, 8).empty());
    cache.clear();
    assert(fs::exists(root / "original.gguf"));
  }
  std::cout << "tensor cache: cold/warm, digest, length, quota, LRU, reserve, "
               "locking, interrupted write and scoped clear passed\n";
}
