// Shared by the native RPC backend and local cache maintenance. Cache entries
// contain immutable weight bytes only; this module never opens original models.
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
extern "C" {
#include "hash/sha256.h"
}
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include "tensor-cache-directory.h"
#include <aclapi.h>
#include <sddl.h>
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace modelloom::tensor_cache {
namespace fs = std::filesystem;
inline constexpr const char *marker = "ModelLoom tensor cache v1\n";
// A restricting SID, not an ordinary user/group grant. Only the private cache
// directory has this ACE; model and credential ACLs remain unchanged.
inline constexpr const wchar_t *cache_sid =
    L"S-1-5-21-1610612737-1297040460-1413693768-1";
inline std::string environment_root() {
#ifdef _WIN32
  wchar_t value[4096]{};
  const DWORD length =
      GetEnvironmentVariableW(L"MODELLOOM_TENSOR_CACHE", value, 4096);
  if (!length || length >= 4096)
    return {};
  const int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value,
                                        static_cast<int>(length), nullptr, 0,
                                        nullptr, nullptr);
  if (bytes <= 0)
    return {};
  std::string root(static_cast<size_t>(bytes), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value,
                          static_cast<int>(length), root.data(), bytes, nullptr,
                          nullptr) != bytes)
    return {};
  return root;
#else
  const char *root = std::getenv("MODELLOOM_TENSOR_CACHE");
  return root ? root : "";
#endif
}
inline std::string digest(const uint8_t *bytes, size_t length) {
  unsigned char result[32];
  sha256_hash(result, bytes, length);
  constexpr char hex[] = "0123456789abcdef";
  std::string value;
  for (auto b : result) {
    value += hex[b >> 4];
    value += hex[b & 15];
  }
  return value;
}
inline bool hash_name(const std::string &name, const std::string &suffix) {
  return name.size() == 64 + suffix.size() && name.substr(64) == suffix &&
         std::all_of(name.begin(), name.begin() + 64, [](char c) {
           return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
         });
}
inline void check_root(const fs::path &root) {
  if (!root.is_absolute())
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#ifdef _WIN32
  if (inherited_root(root))
    return;
#endif
  fs::path current;
  for (const auto &part : root.lexically_normal()) {
    current /= part;
    const auto status = fs::symlink_status(current);
    if (!fs::is_directory(status) || fs::is_symlink(status))
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#ifndef _WIN32
    struct stat access{};
    if (lstat(current.c_str(), &access) ||
        (access.st_uid != getuid() && access.st_uid != 0) ||
        ((access.st_mode & 0022) && !(access.st_mode & S_ISVTX)))
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#endif
#ifdef _WIN32
    const DWORD attributes = GetFileAttributesW(current.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES ||
        (attributes & FILE_ATTRIBUTE_REPARSE_POINT))
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#endif
  }
}
class directory_lease {
#ifdef _WIN32
  HANDLE value = INVALID_HANDLE_VALUE;
#else
  int value = -1;
#endif
public:
  explicit directory_lease(const fs::path &root) {
    check_root(root);
#ifdef _WIN32
    value = CreateFileW(
        root.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    BY_HANDLE_FILE_INFORMATION info{};
    if (value == INVALID_HANDLE_VALUE ||
        !GetFileInformationByHandle(value, &info) ||
        (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
      if (value != INVALID_HANDLE_VALUE)
        CloseHandle(value);
      value = INVALID_HANDLE_VALUE;
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
    }
#else
    value =
        ::open(root.c_str(), O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW);
    if (value < 0)
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#endif
  }
  ~directory_lease() {
#ifdef _WIN32
    if (value != INVALID_HANDLE_VALUE)
      CloseHandle(value);
#else
    if (value >= 0)
      ::close(value);
#endif
  }
  directory_lease(const directory_lease &) = delete;
  directory_lease &operator=(const directory_lease &) = delete;
};
class file {
public:
#ifdef _WIN32
  HANDLE value = INVALID_HANDLE_VALUE;
  file(const fs::path &path, bool write = false, bool create = false,
       bool lock = false) {
    value = CreateFileW(
        path.c_str(),
        write ? GENERIC_READ | GENERIC_WRITE
              : GENERIC_READ | FILE_WRITE_ATTRIBUTES,
        lock || write ? 0 : FILE_SHARE_READ, nullptr,
        create ? CREATE_NEW : (lock ? OPEN_ALWAYS : OPEN_EXISTING),
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (value != INVALID_HANDLE_VALUE) {
      BY_HANDLE_FILE_INFORMATION info{};
      if (!GetFileInformationByHandle(value, &info) ||
          (info.dwFileAttributes &
           (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) ||
          info.nNumberOfLinks != 1)
        close();
    }
  }
  bool valid() const { return value != INVALID_HANDLE_VALUE; }
  void close() {
    if (valid())
      CloseHandle(value);
    value = INVALID_HANDLE_VALUE;
  }
  uint64_t size() const {
    LARGE_INTEGER size{};
    return GetFileSizeEx(value, &size) ? static_cast<uint64_t>(size.QuadPart)
                                       : UINT64_MAX;
  }
  void touch() {
    FILETIME now{};
    GetSystemTimeAsFileTime(&now);
    SetFileTime(value, nullptr, nullptr, &now);
  }
  bool read(uint8_t *bytes, size_t length) {
    while (length) {
      DWORD count = 0;
      const DWORD chunk = static_cast<DWORD>(std::min<size_t>(length, 1048576));
      if (!ReadFile(value, bytes, chunk, &count, nullptr) || count != chunk)
        return false;
      bytes += count;
      length -= count;
    }
    return true;
  }
  bool write(const uint8_t *bytes, size_t length) {
    while (length) {
      DWORD count = 0;
      const DWORD chunk = static_cast<DWORD>(std::min<size_t>(length, 1048576));
      if (!WriteFile(value, bytes, chunk, &count, nullptr) || count != chunk)
        return false;
      bytes += count;
      length -= count;
    }
    return FlushFileBuffers(value) != 0;
  }
#else
  int value = -1;
  file(const fs::path &path, bool write = false, bool create = false,
       bool lock = false) {
    value = ::open(path.c_str(),
                   (write ? O_RDWR : O_RDONLY) | O_CLOEXEC | O_NOFOLLOW |
                       (create ? O_CREAT | O_EXCL : (lock ? O_CREAT : 0)),
                   0600);
    struct stat status{};
    if (value >= 0 && (fstat(value, &status) || !S_ISREG(status.st_mode) ||
                       status.st_nlink != 1 || status.st_uid != getuid() ||
                       (lock && flock(value, LOCK_EX | LOCK_NB))))
      close();
  }
  bool valid() const { return value >= 0; }
  void close() {
    if (valid())
      ::close(value);
    value = -1;
  }
  uint64_t size() const {
    struct stat status{};
    return fstat(value, &status) ? UINT64_MAX
                                 : static_cast<uint64_t>(status.st_size);
  }
  void touch() { futimens(value, nullptr); }
  bool read(uint8_t *bytes, size_t length) {
    while (length) {
      const auto n = ::read(value, bytes, length);
      if (n <= 0)
        return false;
      bytes += n;
      length -= static_cast<size_t>(n);
    }
    return true;
  }
  bool write(const uint8_t *bytes, size_t length) {
    while (length) {
      const auto n = ::write(value, bytes, length);
      if (n <= 0)
        return false;
      bytes += n;
      length -= static_cast<size_t>(n);
    }
    return fsync(value) == 0;
  }
#endif
  file(const file &) = delete;
  file &operator=(const file &) = delete;
  ~file() { close(); }
};

/** Initialize only an empty dedicated directory, or validate its owned marker.
 * No existing arbitrary directory is adopted or recursively cleaned. */
inline void prepare(const fs::path &root) {
  directory_lease held(root);
  const auto identity = root / ".modelloom-tensor-cache-v1";
  if (!fs::exists(identity)) {
    if (!fs::is_empty(root))
      throw std::runtime_error("CACHE_LOCATION_NOT_EMPTY");
    file created(identity, true, true);
    if (!created.valid() ||
        !created.write(reinterpret_cast<const uint8_t *>(marker),
                       std::strlen(marker)))
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  }
  file saved(identity);
  std::vector<uint8_t> bytes(std::strlen(marker));
  if (!saved.valid() || saved.size() != bytes.size() ||
      !saved.read(bytes.data(), bytes.size()) ||
      std::memcmp(bytes.data(), marker, bytes.size()))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#ifdef _WIN32
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  DWORD length = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &length);
  std::vector<uint8_t> storage(length);
  const bool ok = GetTokenInformation(token, TokenUser, storage.data(), length,
                                      &length) != 0;
  CloseHandle(token);
  LPWSTR user = nullptr;
  if (!ok ||
      !ConvertSidToStringSidW(
          reinterpret_cast<TOKEN_USER *>(storage.data())->User.Sid, &user))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  const std::wstring sddl = L"D:P(A;OICI;FA;;;" + std::wstring(user) +
                            L")(A;OICI;FA;;;SY)(A;OICI;FA;;;" + cache_sid +
                            L")";
  LocalFree(user);
  PSECURITY_DESCRIPTOR security = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &security, nullptr))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
  PACL acl = nullptr;
  BOOL present = FALSE, defaulted = FALSE;
  const bool found =
      GetSecurityDescriptorDacl(security, &present, &acl, &defaulted) != 0;
  const DWORD result =
      found
          ? SetNamedSecurityInfoW(
                const_cast<wchar_t *>(root.c_str()), SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                nullptr, nullptr, acl, nullptr)
          : ERROR_INVALID_DATA;
  LocalFree(security);
  if (result != ERROR_SUCCESS)
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#else
  struct stat info{};
  if (lstat(root.c_str(), &info) || info.st_uid != getuid() ||
      chmod(root.c_str(), 0700))
    throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
#endif
}

/** One nonblocking interprocess lease covers verification, publication and
 * eviction. Failure leaves the RPC caller free to transfer the original bytes.
 */
class store {
  fs::path root;
  directory_lease held;
  uint64_t limit, reserve;
  bool replace;
  std::string owner;
  std::unique_ptr<file> lease;
  bool available = false;
  fs::path entry_path(const std::string &hash) const {
    if (owner.empty())
      return root / (hash + ".tensor");
    const auto domain = "ModelLoom/rpc-v8/weights/v1:" + owner + ":" + hash;
    return root / (digest(reinterpret_cast<const uint8_t *>(domain.data()),
                          domain.size()) +
                   ".tensor");
  }
  struct entry {
    fs::path path;
    uint64_t size;
    fs::file_time_type modified;
  };
  std::vector<entry> entries() const {
    std::vector<entry> result;
    for (const auto &item : fs::directory_iterator(root)) {
      const auto status = item.symlink_status();
      if (!fs::is_regular_file(status) || fs::is_symlink(status))
        continue;
      const auto name = item.path().filename().u8string();
      if (name == ".lock" || name == ".modelloom-tensor-cache-v1")
        continue;
      result.push_back({item.path(), item.file_size(), item.last_write_time()});
    }
    return result;
  }
  bool fits(uint64_t size) const {
    const auto used = usage();
    const auto free = fs::space(root).available;
    return size <= limit && used <= limit - size && reserve <= free &&
           size <= free - reserve;
  }
  void reclaim(uint64_t size) {
    if (fits(size) || !replace)
      return;
    auto candidates = entries();
    std::sort(
        candidates.begin(), candidates.end(),
        [](const entry &a, const entry &b) { return a.modified < b.modified; });
    for (const auto &item : candidates) {
      if (fits(size))
        break;
      if (hash_name(item.path.filename().u8string(), ".tensor"))
        fs::remove(item.path);
    }
  }

public:
  store(const fs::path &directory, uint64_t maximum, uint64_t keep_free,
        bool evict, const std::string &source = "")
      : root(directory), held(directory), limit(maximum), reserve(keep_free),
        replace(evict), owner(source) {
    lease = std::make_unique<file>(directory / ".lock", true, false, true);
    if (!lease->valid())
      return;
    file saved(root / ".modelloom-tensor-cache-v1");
    std::vector<uint8_t> bytes(std::strlen(marker));
    if (!saved.valid() || saved.size() != bytes.size() ||
        !saved.read(bytes.data(), bytes.size()) ||
        std::memcmp(bytes.data(), marker, bytes.size()))
      return;
    available = true;
    // No writer survives this lease. Incomplete owned entries are never hits.
    for (const auto &item : entries())
      if (hash_name(item.path.filename().u8string(), ".partial"))
        fs::remove(item.path);
    // Apply a lowered limit/reserve even when every upcoming weight is a hit.
    reclaim(0);
  }
  bool ready() const { return available; }
  uint64_t usage() const {
    if (!available)
      throw std::runtime_error("CACHE_BUSY");
    uint64_t used = 0;
    for (const auto &entry : entries()) {
      if (UINT64_MAX - used < entry.size)
        throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
      used += entry.size;
    }
    return used;
  }
  std::vector<uint8_t> get(const std::string &hash, uint64_t length) {
    if (!available || !hash_name(hash + ".tensor", ".tensor") || !length ||
        length > limit ||
        length > static_cast<uint64_t>(std::numeric_limits<size_t>::max()))
      return {};
    const auto target = entry_path(hash);
    file source(target);
    if (!source.valid() || source.size() != length)
      return {};
    std::vector<uint8_t> bytes(static_cast<size_t>(length));
    if (!source.read(bytes.data(), bytes.size()) ||
        digest(bytes.data(), bytes.size()) != hash)
      return {};
    source.touch();
    return bytes;
  }
  bool put(const uint8_t *bytes, size_t length) {
    if (!available || !length || length > limit)
      return false;
    const auto hash = digest(bytes, length);
    const auto target = entry_path(hash);
    if (!get(hash, length).empty())
      return true;
    // Replace a corrupt recognized entry, never a link or an unrelated file.
    if (fs::exists(target)) {
      if (!fs::is_regular_file(fs::symlink_status(target)))
        return false;
      fs::remove(target);
    }
    reclaim(length);
    if (!fits(length))
      return false;
    const auto temporary = fs::path(target).replace_extension(".partial");
    {
      file output(temporary, true, true);
      if (!output.valid())
        return false;
      if (!output.write(bytes, length)) {
        output.close();
        fs::remove(temporary);
        return false;
      }
    }
    // Another application may have consumed disk space since reservation.
    if (fs::space(root).available < reserve) {
      fs::remove(temporary);
      return false;
    }
    fs::rename(temporary, target);
    return true;
  }
  void clear() {
    if (!available)
      throw std::runtime_error("CACHE_BUSY");
    for (const auto &item : entries()) {
      const auto name = item.path.filename().u8string();
      if (hash_name(name, ".tensor") || hash_name(name, ".partial"))
        fs::remove(item.path);
    }
  }
};
} // namespace modelloom::tensor_cache
