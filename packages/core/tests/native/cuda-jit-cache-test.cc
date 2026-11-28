#include "../../native/cuda-jit-cache.h"
#include <cassert>
#include <fstream>
#include <iostream>

namespace fs = std::filesystem;
using modelloom::cuda_jit_cache::directory;

template <typename F> void rejects(F action) {
  bool denied = false;
  try {
    action();
  } catch (const std::exception &) {
    denied = true;
  }
  assert(denied);
}

void private_parent(const fs::path &path, PSID user) {
  LPWSTR encoded = nullptr;
  assert(ConvertSidToStringSidW(user, &encoded));
  const std::wstring sddl =
      L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + std::wstring(encoded) + L")";
  LocalFree(encoded);
  PSECURITY_DESCRIPTOR security = nullptr;
  assert(ConvertStringSecurityDescriptorToSecurityDescriptorW(
      sddl.c_str(), SDDL_REVISION_1, &security, nullptr));
  BOOL present = FALSE, defaulted = FALSE;
  PACL acl = nullptr;
  assert(GetSecurityDescriptorDacl(security, &present, &acl, &defaulted));
  assert(SetNamedSecurityInfoW(
             const_cast<wchar_t *>(path.c_str()), SE_FILE_OBJECT,
             DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
             nullptr, nullptr, acl, nullptr) == ERROR_SUCCESS);
  LocalFree(security);
}

int main(int argc, char **argv) try {
  assert(argc == 2);
  const fs::path base = fs::u8path(argv[1]);
  HANDLE token = nullptr;
  assert(OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &token));
  DWORD bytes = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &bytes);
  std::vector<unsigned char> user(bytes);
  assert(GetTokenInformation(token, TokenUser, user.data(), bytes, &bytes));
  const auto owner = reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid;
  const auto profile = base / "private-profile";
  const auto runtime = profile / "runtimes" / "verified-version";
  fs::create_directories(runtime);
  private_parent(profile, owner);
  {
    std::ofstream secret(profile / "private.txt");
    secret << "private";
  }

  BYTE users[SECURITY_MAX_SID_SIZE]{}, world[SECURITY_MAX_SID_SIZE]{};
  DWORD length = sizeof(users);
  assert(CreateWellKnownSid(WinBuiltinUsersSid, nullptr, users, &length));
  length = sizeof(world);
  assert(CreateWellKnownSid(WinWorldSid, nullptr, world, &length));
  PSID jit = nullptr;
  assert(
      ConvertStringSidToSidW(modelloom::cuda_jit_cache::restricting_sid, &jit));
  SID_AND_ATTRIBUTES restrictions[] = {{users, 0}, {world, 0}, {jit, 0}};
  HANDLE restricted = nullptr, no_cache = nullptr;
  assert(CreateRestrictedToken(token, DISABLE_MAX_PRIVILEGE | LUA_TOKEN, 0,
                               nullptr, 0, nullptr, 3, restrictions,
                               &restricted));
  assert(CreateRestrictedToken(token, DISABLE_MAX_PRIVILEGE | LUA_TOKEN, 0,
                               nullptr, 0, nullptr, 2, restrictions,
                               &no_cache));
  // Match the real launcher's medium-integrity worker, including elevated runs.
  BYTE medium[SECURITY_MAX_SID_SIZE]{};
  length = sizeof(medium);
  assert(CreateWellKnownSid(WinMediumLabelSid, nullptr, medium, &length));
  TOKEN_MANDATORY_LABEL label{{medium, SE_GROUP_INTEGRITY}};
  assert(SetTokenInformation(
      restricted, TokenIntegrityLevel, &label,
      static_cast<DWORD>(sizeof(label) + GetLengthSid(medium))));
  LocalFree(jit);
  CloseHandle(token);
  fs::path cache;
  {
    directory selected(runtime);
    cache = selected.path();
    PACL mandatory = nullptr;
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    assert(GetNamedSecurityInfoW(const_cast<wchar_t *>(cache.c_str()),
                                 SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION,
                                 nullptr, nullptr, nullptr, &mandatory,
                                 &descriptor) == ERROR_SUCCESS);
    assert(mandatory && mandatory->AceCount == 1);
    void *entry = nullptr;
    assert(GetAce(mandatory, 0, &entry));
    const auto integrity = static_cast<SYSTEM_MANDATORY_LABEL_ACE *>(entry);
    assert(integrity->Header.AceType == SYSTEM_MANDATORY_LABEL_ACE_TYPE);
    assert(EqualSid(&integrity->SidStart, medium));
    LocalFree(descriptor);
    assert(cache.parent_path() == runtime.parent_path());
    assert(!MoveFileExW(profile.c_str(), (base / "moved").c_str(), 0));
    assert(ImpersonateLoggedOnUser(restricted));
    HANDLE file = CreateFileW((cache / "compiled.bin").c_str(),
                              GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                              CREATE_NEW, 0, nullptr);
    const bool writable = file != INVALID_HANDLE_VALUE;
    if (writable) {
      DWORD written = 0;
      assert(WriteFile(file, "JIT", 3, &written, nullptr));
      assert(written == 3);
      CloseHandle(file);
    }
    HANDLE secret =
        CreateFileW((profile / "private.txt").c_str(), GENERIC_READ,
                    FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    const bool private_denied =
        secret == INVALID_HANDLE_VALUE && GetLastError() == ERROR_ACCESS_DENIED;
    if (secret != INVALID_HANDLE_VALUE)
      CloseHandle(secret);
    assert(RevertToSelf());
    assert(writable && private_denied);
    assert(ImpersonateLoggedOnUser(no_cache));
    HANDLE denied =
        CreateFileW((cache / "compiled.bin").c_str(), GENERIC_READ,
                    FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    const bool capability_denied =
        denied == INVALID_HANDLE_VALUE && GetLastError() == ERROR_ACCESS_DENIED;
    if (denied != INVALID_HANDLE_VALUE)
      CloseHandle(denied);
    assert(RevertToSelf());
    assert(capability_denied);
  }
  {
    directory warm(runtime);
    assert(warm.path() == cache);
    assert(ImpersonateLoggedOnUser(restricted));
    HANDLE file =
        CreateFileW((cache / "compiled.bin").c_str(), GENERIC_READ,
                    FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    char value[3]{};
    DWORD read = 0;
    const bool reused = file != INVALID_HANDLE_VALUE &&
                        ReadFile(file, value, 3, &read, nullptr) && read == 3 &&
                        std::string(value, 3) == "JIT";
    if (file != INVALID_HANDLE_VALUE)
      CloseHandle(file);
    assert(RevertToSelf());
    assert(reused);
  }
  CloseHandle(restricted);
  CloseHandle(no_cache);
  // Unexpected existing ACLs are rejected, never repaired/adopted as storage.
  private_parent(cache, owner);
  rejects([&] { directory invalid(runtime); });
  PSECURITY_DESCRIPTOR broad = nullptr;
  assert(ConvertStringSecurityDescriptorToSecurityDescriptorW(
      L"D:P(A;OICI;FA;;;WD)", SDDL_REVISION_1, &broad, nullptr));
  PACL public_acl = nullptr;
  BOOL present = FALSE, defaulted = FALSE;
  assert(GetSecurityDescriptorDacl(broad, &present, &public_acl, &defaulted));
  assert(SetNamedSecurityInfoW(
             const_cast<wchar_t *>(cache.c_str()), SE_FILE_OBJECT,
             DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
             nullptr, nullptr, public_acl, nullptr) == ERROR_SUCCESS);
  LocalFree(broad);
  rejects([&] { directory invalid(runtime); });
  private_parent(cache, owner);
  rejects([&] { directory invalid(fs::path(L"relative")); });
  rejects([&] { directory invalid(runtime / L".." / L"verified-version"); });
  fs::create_directories(base / "junction" / "version");
  rejects([&] { directory invalid(base / "junction" / "version"); });
  rejects(
      [&] { directory invalid(base / "redirect" / "runtimes" / "version"); });
  assert(!fs::exists(base / "target" / "modelloom-rpc-cuda-jit-v1"));
  std::cout
      << "PASS: persistent restricted JIT access, private-file/capability "
         "denial, ancestor pins, ACL rejection and junction denial\n";
} catch (const std::exception &error) {
  std::cerr << error.what() << " (Windows error " << GetLastError() << ")\n";
  return 1;
}
