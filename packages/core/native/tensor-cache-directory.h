#pragma once
#ifdef _WIN32
#include <cstdint>
#include <cwchar>
#include <filesystem>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#include <windows.h>

namespace modelloom::tensor_cache {
inline constexpr const wchar_t *root_handle_variable =
    L"MODELLOOM_TENSOR_CACHE_ROOT_HANDLE";

/** The trusted helper keeps every checked ancestor non-renamable until its
 * contained worker exits. Only the selected root's read-attributes handle is
 * inherited; profile parents receive no new permissions. */
class pinned_directory {
  std::vector<HANDLE> handles;

public:
  explicit pinned_directory(const std::filesystem::path &root) {
    if (!root.is_absolute() || root.lexically_normal() != root)
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
    try {
      auto current = root.root_path();
      const auto pin = [&] {
        HANDLE handle = CreateFileW(
            current.c_str(), FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
        if (handle == INVALID_HANDLE_VALUE)
          throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
        try {
          handles.push_back(handle);
        } catch (...) {
          CloseHandle(handle);
          throw;
        }
        BY_HANDLE_FILE_INFORMATION info{};
        if (!GetFileInformationByHandle(handle, &info) ||
            !(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
            (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
          throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
      };
      pin();
      for (const auto &part : root.relative_path()) {
        current /= part;
        pin();
      }
    } catch (...) {
      for (const auto handle : handles)
        CloseHandle(handle);
      throw;
    }
  }
  ~pinned_directory() {
    for (const auto handle : handles)
      CloseHandle(handle);
  }
  pinned_directory(const pinned_directory &) = delete;
  pinned_directory &operator=(const pinned_directory &) = delete;
  HANDLE inherit_root() const {
    HANDLE result = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), handles.back(),
                         GetCurrentProcess(), &result, 0, TRUE,
                         DUPLICATE_SAME_ACCESS))
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
    return result;
  }
};

/** A restricted worker may use only the helper's inherited, path-matched root.
 * Without that capability the original full path validation remains required.
 */
inline bool inherited_root(const std::filesystem::path &root) {
  wchar_t encoded[32]{};
  const DWORD count =
      GetEnvironmentVariableW(root_handle_variable, encoded, 32);
  if (!count)
    return false;
  if (count >= 32)
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  uintptr_t value = 0;
  for (DWORD index = 0; index < count; ++index) {
    const auto digit = encoded[index] - L'0';
    if (digit < 0 || digit > 9 ||
        value > (std::numeric_limits<uintptr_t>::max() - digit) / 10)
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
    value = value * 10 + digit;
  }
  HANDLE token = nullptr;
  if (!OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &token) &&
      (GetLastError() != ERROR_NO_TOKEN ||
       !OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  const bool restricted = IsTokenRestricted(token) != FALSE;
  CloseHandle(token);
  HANDLE handle = reinterpret_cast<HANDLE>(value);
  BY_HANDLE_FILE_INFORMATION info{};
  if (!restricted || !value || handle == INVALID_HANDLE_VALUE ||
      !GetFileInformationByHandle(handle, &info) ||
      !(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  std::wstring actual(32768, L'\0');
  const DWORD length = GetFinalPathNameByHandleW(
      handle, actual.data(), static_cast<DWORD>(actual.size()),
      FILE_NAME_OPENED | VOLUME_NAME_DOS);
  if (!length || length >= actual.size())
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  actual.resize(length);
  if (actual.compare(0, 8, L"\\\\?\\UNC\\") == 0)
    actual = L"\\\\" + actual.substr(8);
  else if (actual.compare(0, 4, L"\\\\?\\") == 0)
    actual.erase(0, 4);
  if (_wcsicmp(actual.c_str(), root.lexically_normal().c_str()) != 0)
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  return true;
}
} // namespace modelloom::tensor_cache
#endif
