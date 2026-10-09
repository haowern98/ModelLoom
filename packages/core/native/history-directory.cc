#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <aclapi.h>
#include <memory>
#include <node_api.h>
#include <sddl.h>
#include <string>
#include <vector>
#include <windows.h>

namespace {
constexpr LONGLONG database_limit = 120LL * 1024 * 1024;
constexpr LONGLONG journal_limit = 136LL * 1024 * 1024;
struct Handle {
  HANDLE value;
  explicit Handle(HANDLE v) : value(v) {}
  ~Handle() {
    if (value && value != INVALID_HANDLE_VALUE)
      CloseHandle(value);
  }
  Handle(const Handle &) = delete;
  Handle &operator=(const Handle &) = delete;
};
struct Guard {
  std::vector<std::unique_ptr<Handle>> directories;
  std::unique_ptr<Handle> database, journal;
};
const napi_type_tag tag = {0xa7c032458fdc43cd, 0x8cf94ead0dbe4238};
napi_value fail(napi_env env) {
  napi_throw_error(env, nullptr, "HISTORY_UNAVAILABLE");
  return nullptr;
}
napi_value nothing(napi_env env) {
  napi_value value;
  return napi_get_undefined(env, &value) == napi_ok ? value : fail(env);
}
bool argument(napi_env env, napi_callback_info info, napi_value &value) {
  size_t count = 2;
  napi_value values[2]{};
  if (napi_get_cb_info(env, info, &count, values, nullptr, nullptr) !=
          napi_ok ||
      count != 1)
    return false;
  value = values[0];
  return true;
}
Guard *guard(napi_env env, napi_value value) {
  bool matches = false;
  void *data = nullptr;
  if (napi_check_object_type_tag(env, value, &tag, &matches) != napi_ok ||
      !matches || napi_unwrap(env, value, &data) != napi_ok)
    return nullptr;
  return static_cast<Guard *>(data);
}
bool named(HANDLE handle, const std::wstring &expected, bool directory) {
  BY_HANDLE_FILE_INFORMATION info{};
  std::vector<wchar_t> final(32768);
  DWORD length = GetFinalPathNameByHandleW(
      handle, final.data(), static_cast<DWORD>(final.size()),
      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (handle == INVALID_HANDLE_VALUE ||
      !GetFileInformationByHandle(handle, &info) ||
      (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
      ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != directory ||
      (!directory &&
       (info.nNumberOfLinks != 1 || GetFileType(handle) != FILE_TYPE_DISK)) ||
      length == 0 || length >= final.size())
    return false;
  const std::wstring actual(final.data(), length),
      wanted = L"\\\\?\\" + expected;
  return CompareStringOrdinal(actual.c_str(), -1, wanted.c_str(), -1, TRUE) ==
         CSTR_EQUAL;
}
bool private_acl(HANDLE handle, PSECURITY_DESCRIPTOR descriptor) {
  BOOL present = FALSE, defaulted = FALSE;
  PACL acl = nullptr;
  return GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted) &&
         present && acl &&
         SetSecurityInfo(handle, SE_FILE_OBJECT,
                         DACL_SECURITY_INFORMATION |
                             PROTECTED_DACL_SECURITY_INFORMATION,
                         nullptr, nullptr, acl, nullptr) == ERROR_SUCCESS;
}
bool within(HANDLE handle, LONGLONG maximum) {
  LARGE_INTEGER size{};
  return GetFileSizeEx(handle, &size) && size.QuadPart >= 0 &&
         size.QuadPart <= maximum;
}
bool entries(const std::wstring &directory) {
  WIN32_FIND_DATAW data{};
  HANDLE find = FindFirstFileW((directory + L"\\*").c_str(), &data);
  if (find == INVALID_HANDLE_VALUE)
    return false;
  bool ok = true;
  do {
    const std::wstring name(data.cFileName);
    if (name != L"." && name != L".." && name != L"history.sqlite" &&
        name != L"history.sqlite-journal") {
      ok = false;
      break;
    }
  } while (FindNextFileW(find, &data));
  if (ok && GetLastError() != ERROR_NO_MORE_FILES)
    ok = false;
  FindClose(find);
  return ok;
}
std::unique_ptr<Handle> file(const std::wstring &name,
                             PSECURITY_DESCRIPTOR descriptor, LONGLONG limit) {
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
  auto result = std::make_unique<Handle>(
      CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE | WRITE_DAC,
                  FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_ALWAYS,
                  FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (!named(result->value, name, false) || !within(result->value, limit))
    return nullptr;
  return result;
}
/** Capture top-down ancestors before creating the child; deny delete sharing
 * and handle inheritance. */
napi_value open(napi_env env, napi_callback_info info) {
  napi_value value;
  size_t length = 0;
  if (!argument(env, info, value) ||
      napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok ||
      length < 4 || length > 32000)
    return fail(env);
  std::vector<char16_t> characters(length + 1);
  if (napi_get_value_string_utf16(env, value, characters.data(),
                                  characters.size(), &length) != napi_ok)
    return fail(env);
  std::wstring root;
  for (size_t i = 0; i < length; ++i)
    root.push_back(static_cast<wchar_t>(characters[i]));
  if (root[1] != L':' || root[2] != L'\\' ||
      root.find(L':', 2) != std::wstring::npos ||
      root.find(L'\0') != std::wstring::npos ||
      root.find(L'/') != std::wstring::npos || root.back() == L'\\')
    return fail(env);
  HANDLE raw = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw))
    return fail(env);
  Handle token(raw);
  DWORD bytes = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &bytes);
  std::vector<unsigned char> user(bytes);
  if (!GetTokenInformation(token.value, TokenUser, user.data(), bytes, &bytes))
    return fail(env);
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(
          reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid, &sid))
    return fail(env);
  const std::wstring sddl =
      L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + std::wstring(sid) + L")";
  LocalFree(sid);
  PSECURITY_DESCRIPTOR raw_descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &raw_descriptor, nullptr))
    return fail(env);
  auto free_descriptor = [](void *pointer) { LocalFree(pointer); };
  std::unique_ptr<void, decltype(free_descriptor)> descriptor(raw_descriptor,
                                                              free_descriptor);
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor.get(),
                               FALSE};
  auto result = std::make_unique<Guard>();
  for (size_t end = 3;;) {
    const std::wstring component = root.substr(0, end);
    // Only the final app folder may be created, after its ancestors are held.
    if (end == root.size() && !result->directories.empty() &&
        !CreateDirectoryW(component.c_str(), &security) &&
        GetLastError() != ERROR_ALREADY_EXISTS)
      return fail(env);
    auto handle = std::make_unique<Handle>(CreateFileW(
        component.c_str(), FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    if (!named(handle->value, component, true))
      return fail(env);
    result->directories.push_back(std::move(handle));
    if (end == root.size())
      break;
    end = root.find(L'\\', end + 1);
    if (end == std::wstring::npos)
      end = root.size();
    if (result->directories.size() > 64)
      return fail(env);
  }
  const std::wstring directory = root + L"\\chat";
  if (!CreateDirectoryW(directory.c_str(), &security) &&
      GetLastError() != ERROR_ALREADY_EXISTS)
    return fail(env);
  auto managed = std::make_unique<Handle>(CreateFileW(
      directory.c_str(),
      FILE_READ_ATTRIBUTES | READ_CONTROL | FILE_LIST_DIRECTORY | WRITE_DAC,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
      FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
  if (!named(managed->value, directory, true) || !entries(directory))
    return fail(env);
  result->directories.push_back(std::move(managed));
  result->database =
      file(directory + L"\\history.sqlite", descriptor.get(), database_limit);
  if (!result->database)
    return fail(env);
  OVERLAPPED lock{};
  lock.Offset = 0xfff00000;
  lock.OffsetHigh = 0x7fffffff;
  if (!LockFileEx(result->database->value,
                  LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0,
                  &lock))
    return fail(env);
  result->journal = file(directory + L"\\history.sqlite-journal",
                         descriptor.get(), journal_limit);
  if (!result->journal)
    return fail(env);
  // Reject all existing file identities before an inheritable DACL can touch
  // children.
  if (!private_acl(result->directories.back()->value, descriptor.get()) ||
      !private_acl(result->database->value, descriptor.get()) ||
      !private_acl(result->journal->value, descriptor.get()))
    return fail(env);
  napi_value object;
  if (napi_create_object(env, &object) != napi_ok ||
      napi_type_tag_object(env, object, &tag) != napi_ok ||
      napi_wrap(
          env, object, result.get(),
          [](napi_env, void *data, void *) {
            delete static_cast<Guard *>(data);
          },
          nullptr, nullptr) != napi_ok)
    return fail(env);
  result.release();
  return object;
}
/** Physically allocate capacity without changing EOF or overwriting recovery
 * data. */
napi_value reserve(napi_env env, napi_callback_info info) {
  napi_value value;
  if (!argument(env, info, value))
    return fail(env);
  Guard *data = guard(env, value);
  if (!data || !data->database || !data->journal ||
      !within(data->database->value, database_limit) ||
      !within(data->journal->value, journal_limit))
    return fail(env);
  FILE_ALLOCATION_INFO allocation{};
  allocation.AllocationSize.QuadPart = journal_limit;
  if (!SetFileInformationByHandle(data->journal->value, FileAllocationInfo,
                                  &allocation, sizeof(allocation)))
    return fail(env);
  return nothing(env);
}
napi_value close(napi_env env, napi_callback_info info) {
  napi_value value;
  if (!argument(env, info, value))
    return fail(env);
  Guard *data = guard(env, value);
  if (!data)
    return fail(env);
  data->journal.reset();
  data->database.reset();
  data->directories.clear();
  return nothing(env);
}
template <napi_value (*Callback)(napi_env, napi_callback_info)>
napi_value checked(napi_env env, napi_callback_info info) {
  try {
    return Callback(env, info);
  } catch (...) {
    return fail(env);
  }
}
} // namespace
NAPI_MODULE_INIT() {
  const napi_property_descriptor properties[] = {
      {"open", nullptr, checked<open>, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"reserve", nullptr, checked<reserve>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"close", nullptr, checked<close>, nullptr, nullptr, nullptr,
       napi_default, nullptr}};
  return napi_define_properties(env, exports, 3, properties) == napi_ok
             ? exports
             : fail(env);
}
