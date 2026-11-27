#pragma once
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include "tensor-cache-directory.h"
#include <aclapi.h>
#include <memory>
#include <sddl.h>

namespace modelloom::cuda_jit_cache {
// A separate restricting capability: tensor-cache permission does not grant
// access to executable JIT artifacts, or vice versa.
inline constexpr const wchar_t *restricting_sid =
    L"S-1-5-21-1610612737-1297040460-1413693768-2";

/** Persistent driver-only storage next to the verified runtime versions.
 * Never uses a caller's CUDA_CACHE_PATH or the global NVIDIA/profile cache.
 * Its protected ACL grants the current user, SYSTEM and the JIT restricting
 * capability only. Ancestors stay pinned until the contained worker exits.
 * Failure is optional: the launcher retains CUDA_CACHE_DISABLE=1.
 */
class directory {
  std::filesystem::path selected;
  std::unique_ptr<tensor_cache::pinned_directory> parent, held;
  struct handle {
    HANDLE value = nullptr;
    ~handle() {
      if (value && value != INVALID_HANDLE_VALUE)
        CloseHandle(value);
    }
  };
  struct local {
    HLOCAL value = nullptr;
    ~local() {
      if (value)
        LocalFree(value);
    }
  };
  [[noreturn]] static void fail() {
    throw std::runtime_error("CUDA_JIT_CACHE_UNAVAILABLE");
  }

public:
  explicit directory(const std::filesystem::path &runtime) {
    if (!runtime.is_absolute() || runtime.lexically_normal() != runtime ||
        runtime.parent_path() == runtime.root_path())
      fail();
    parent =
        std::make_unique<tensor_cache::pinned_directory>(runtime.parent_path());
    selected = runtime.parent_path() / L"modelloom-rpc-cuda-jit-v1";
    handle token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token.value))
      fail();
    DWORD size = 0;
    GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
    std::vector<unsigned char> user(size);
    if (!GetTokenInformation(token.value, TokenUser, user.data(), size, &size))
      fail();
    const auto userSid = reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid;
    LPWSTR encoded = nullptr;
    if (!ConvertSidToStringSidW(userSid, &encoded))
      fail();
    local encodedOwner{encoded};
    const std::wstring sddl =
        L"O:" + std::wstring(encoded) + L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" +
        std::wstring(encoded) + L")(A;OICI;FA;;;" + restricting_sid + L")";
    PSECURITY_DESCRIPTOR security = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, &security, nullptr))
      fail();
    local descriptor{security};
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), security,
                                   FALSE};
    const bool created =
        CreateDirectoryW(selected.c_str(), &attributes) != FALSE;
    if (!created && GetLastError() != ERROR_ALREADY_EXISTS)
      fail();
    held = std::make_unique<tensor_cache::pinned_directory>(selected);
    handle root{CreateFileW(
        selected.c_str(),
        READ_CONTROL | FILE_READ_ATTRIBUTES | (created ? WRITE_OWNER : 0),
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr)};
    if (root.value == INVALID_HANDLE_VALUE)
      fail();
    if (created) {
      PSECURITY_DESCRIPTOR labelDescriptor = nullptr;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
              L"S:(ML;OICI;NW;;;ME)", SDDL_REVISION_1, &labelDescriptor,
              nullptr))
        fail();
      local ownedLabel{labelDescriptor};
      BOOL present = FALSE, defaulted = FALSE;
      PACL label = nullptr;
      if (!GetSecurityDescriptorSacl(labelDescriptor, &present, &label,
                                     &defaulted) ||
          !present || !label ||
          SetSecurityInfo(root.value, SE_FILE_OBJECT,
                          LABEL_SECURITY_INFORMATION, nullptr, nullptr, nullptr,
                          label) != ERROR_SUCCESS)
        fail();
    }
    PSID owner = nullptr;
    PACL acl = nullptr, mandatory = nullptr;
    PSECURITY_DESCRIPTOR actual = nullptr;
    if (GetSecurityInfo(root.value, SE_FILE_OBJECT,
                        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                            LABEL_SECURITY_INFORMATION,
                        &owner, nullptr, &acl, &mandatory,
                        &actual) != ERROR_SUCCESS)
      fail();
    local actualDescriptor{actual};
    SECURITY_DESCRIPTOR_CONTROL control = 0;
    DWORD revision = 0;
    if (!EqualSid(owner, userSid) || !acl || acl->AceCount != 3 ||
        !GetSecurityDescriptorControl(actual, &control, &revision) ||
        !(control & SE_DACL_PROTECTED))
      fail();
    BYTE system[SECURITY_MAX_SID_SIZE]{};
    size = sizeof(system);
    if (!CreateWellKnownSid(WinLocalSystemSid, nullptr, system, &size))
      fail();
    PSID capability = nullptr;
    if (!ConvertStringSidToSidW(restricting_sid, &capability))
      fail();
    local capabilitySid{capability};
    PSID allowed[] = {userSid, system, capability};
    unsigned seen = 0;
    for (DWORD index = 0; index < acl->AceCount; ++index) {
      void *entry = nullptr;
      if (!GetAce(acl, index, &entry))
        fail();
      const auto ace = static_cast<ACCESS_ALLOWED_ACE *>(entry);
      if (ace->Header.AceType != ACCESS_ALLOWED_ACE_TYPE ||
          ace->Header.AceFlags !=
              (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) ||
          ace->Mask != FILE_ALL_ACCESS)
        fail();
      unsigned found = 0;
      for (unsigned sid = 0; sid < 3; ++sid)
        if (EqualSid(&ace->SidStart, allowed[sid]))
          found = 1U << sid;
      if (!found || (seen & found))
        fail();
      seen |= found;
    }
    if (seen != 7)
      fail();
    // The helper can be elevated, but its worker is explicitly medium IL.
    // A high-integrity cache would silently prevent driver writes/reuse.
    BYTE medium[SECURITY_MAX_SID_SIZE]{};
    size = sizeof(medium);
    if (!CreateWellKnownSid(WinMediumLabelSid, nullptr, medium, &size) ||
        !mandatory || mandatory->AceCount != 1)
      fail();
    void *labelEntry = nullptr;
    if (!GetAce(mandatory, 0, &labelEntry))
      fail();
    const auto label = static_cast<SYSTEM_MANDATORY_LABEL_ACE *>(labelEntry);
    if (label->Header.AceType != SYSTEM_MANDATORY_LABEL_ACE_TYPE ||
        label->Header.AceFlags !=
            (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) ||
        label->Mask != SYSTEM_MANDATORY_LABEL_NO_WRITE_UP ||
        !EqualSid(&label->SidStart, medium))
      fail();
  }
  directory(const directory &) = delete;
  directory &operator=(const directory &) = delete;
  const std::filesystem::path &path() const { return selected; }
};
} // namespace modelloom::cuda_jit_cache
#endif
