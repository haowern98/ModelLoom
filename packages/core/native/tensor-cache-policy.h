#pragma once
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>
#include <windows.h>

namespace modelloom {
/** Decode only the PID-bound local owner's Open payload. Remote RPC Data is
 * never accepted as helper control or as worker environment settings. */
inline void apply_cache_policy(const char *bytes, size_t length) {
  const wchar_t *names[] = {
      L"MODELLOOM_TENSOR_CACHE",         L"MODELLOOM_TENSOR_CACHE_LIMIT",
      L"MODELLOOM_TENSOR_CACHE_RESERVE", L"MODELLOOM_TENSOR_CACHE_REPLACE",
      L"MODELLOOM_TENSOR_CACHE_OWNER",   L"MODELLOOM_TENSOR_CACHE_ROOT_HANDLE"};
  for (const auto name : names)
    SetEnvironmentVariableW(name, nullptr);
  if (!length)
    return;
  if (length <= 82 || length > 4178 || bytes[0] != 1 ||
      (bytes[1] != 0 && bytes[1] != 1))
    throw std::runtime_error("INVALID_CACHE_POLICY");
  uint64_t limit = 0, reserve = 0;
  std::memcpy(&limit, bytes + 2, 8);
  std::memcpy(&reserve, bytes + 10, 8);
  if (limit < (1ULL << 30) || limit > (1ULL << 50) || reserve < (1ULL << 30) ||
      reserve > (1ULL << 50))
    throw std::runtime_error("INVALID_CACHE_POLICY");
  std::wstring owner;
  for (size_t i = 18; i < 82; ++i) {
    const char c = bytes[i];
    if (!((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9')))
      throw std::runtime_error("INVALID_CACHE_POLICY");
    owner += static_cast<wchar_t>(c);
  }
  const int size = static_cast<int>(length - 82);
  const int wide = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                       bytes + 82, size, nullptr, 0);
  if (wide <= 0)
    throw std::runtime_error("INVALID_CACHE_POLICY");
  std::wstring root(static_cast<size_t>(wide), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes + 82, size,
                          root.data(), wide) != wide ||
      root.find_first_of(L"\r\n") != std::wstring::npos ||
      root.find(L'\0') != std::wstring::npos ||
      !std::filesystem::path(root).is_absolute() ||
      std::filesystem::path(root).lexically_normal() !=
          std::filesystem::path(root))
    throw std::runtime_error("INVALID_CACHE_POLICY");
  const std::wstring values[] = {root, std::to_wstring(limit),
                                 std::to_wstring(reserve),
                                 bytes[1] == 1 ? L"1" : L"0", owner};
  for (size_t i = 0; i < 5; ++i)
    if (!SetEnvironmentVariableW(names[i], values[i].c_str()))
      throw std::runtime_error("INVALID_CACHE_POLICY");
}
} // namespace modelloom
