#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <aclapi.h>
#include <cstdint>
#include <iphlpapi.h>
#include <memory>
#include <node_api.h>
#include <psapi.h>
#include <sddl.h>
#include <shlobj.h>
#include <string>
#include <vector>
#include <windows.h>
#include <winsock2.h>

namespace {
struct Handle {
  HANDLE value = nullptr;
  Handle() = default;
  explicit Handle(HANDLE v) : value(v) {}
  Handle(const Handle &) = delete;
  Handle &operator=(const Handle &) = delete;
  ~Handle() { reset(); }
  void reset(HANDLE next = nullptr) {
    if (value && value != INVALID_HANDLE_VALUE)
      CloseHandle(value);
    value = next;
  }
};
struct Deployment {
  Handle job;
  std::vector<HANDLE> cores;
  ~Deployment() {
    for (auto core : cores)
      CloseHandle(core);
  }
};
struct Child {
  Handle job, process, input, output, server;
  DWORD pid = 0;
  DWORD server_pid = 0;
  bool sent_stop = false;
  bool sent_abort = false;
  SIZE_T helper_peak_ws = 0, server_peak_ws = 0;
};
struct Files {
  std::vector<std::unique_ptr<Handle>> handles;
};
const napi_type_tag files_tag = {0x6c3d86eb2eab4b65, 0x91e8ad26d78ad73c};
const napi_type_tag root_tag = {0x38b514ec25dc489c, 0xb3825916e5144c9a};
const napi_type_tag child_tag = {0x450b2a77cf054caa, 0x9c7901d1b657928a};

napi_value fail(napi_env env, const char *code) {
  napi_throw_error(env, nullptr, code);
  return nullptr;
}
template <typename T>
T *unwrap(napi_env env, napi_value value, const napi_type_tag &tag) {
  bool matches = false;
  void *pointer = nullptr;
  if (napi_check_object_type_tag(env, value, &tag, &matches) != napi_ok ||
      !matches || napi_unwrap(env, value, &pointer) != napi_ok || !pointer)
    return nullptr;
  return static_cast<T *>(pointer);
}
template <typename T>
napi_value wrap(napi_env env, std::unique_ptr<T> data,
                const napi_type_tag &tag) {
  napi_value object;
  if (napi_create_object(env, &object) != napi_ok ||
      napi_type_tag_object(env, object, &tag) != napi_ok ||
      napi_wrap(
          env, object, data.get(),
          [](napi_env, void *p, void *) { delete static_cast<T *>(p); },
          nullptr, nullptr) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  data.release();
  return object;
}
bool arguments(napi_env env, napi_callback_info info, size_t count,
               napi_value *values) {
  size_t actual = count + 1;
  napi_value all[6]{};
  if (count > 5 ||
      napi_get_cb_info(env, info, &actual, all, nullptr, nullptr) != napi_ok ||
      actual != count)
    return false;
  for (size_t i = 0; i < count; ++i)
    values[i] = all[i];
  return true;
}
napi_value nothing(napi_env env) {
  napi_value result;
  if (napi_get_undefined(env, &result) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}
/** Fresh directories receive a protected current-user/SYSTEM DACL at creation.
 */
napi_value private_directory(napi_env env, napi_callback_info info) {
  napi_value values[1];
  std::wstring directory;
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  size_t length = 0;
  if (napi_get_value_string_utf16(env, values[0], nullptr, 0, &length) !=
          napi_ok ||
      !length || length > 32700)
    return fail(env, "INVALID_CONTROL");
  std::vector<char16_t> name(length + 1);
  if (napi_get_value_string_utf16(env, values[0], name.data(), name.size(),
                                  &length) != napi_ok)
    return fail(env, "INVALID_CONTROL");
  for (size_t i = 0; i < length; i++)
    directory.push_back(static_cast<wchar_t>(name[i]));
  if (directory.find(L'\0') != std::wstring::npos || directory.size() < 4 ||
      directory[1] != L':' || directory[2] != L'\\' ||
      directory.find(L':', 2) != std::wstring::npos)
    return fail(env, "INVALID_CONTROL");
  std::vector<std::unique_ptr<Handle>> ancestors;
  std::wstring parent = directory;
  for (size_t depth = 0; parent.size() > 3; ++depth) {
    if (depth > 64)
      return fail(env, "OWNERSHIP_FAILED");
    const size_t slash = parent.find_last_of(L'\\');
    if (slash == std::wstring::npos)
      return fail(env, "INVALID_CONTROL");
    parent = parent.substr(0, slash == 2 ? 3 : slash);
    auto handle = std::make_unique<Handle>(CreateFileW(
        parent.c_str(), FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    BY_HANDLE_FILE_INFORMATION attributes{};
    if (handle->value == INVALID_HANDLE_VALUE ||
        !GetFileInformationByHandle(handle->value, &attributes) ||
        (attributes.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        !(attributes.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
      return fail(env, "OWNERSHIP_FAILED");
    ancestors.push_back(std::move(handle));
  }
  Handle token;
  HANDLE raw = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw))
    return fail(env, "OWNERSHIP_FAILED");
  token.reset(raw);
  DWORD bytes = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &bytes);
  std::vector<unsigned char> user(bytes);
  if (!GetTokenInformation(token.value, TokenUser, user.data(), bytes, &bytes))
    return fail(env, "OWNERSHIP_FAILED");
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(
          reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid, &sid))
    return fail(env, "OWNERSHIP_FAILED");
  const std::wstring sddl =
      L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + std::wstring(sid) + L")";
  LocalFree(sid);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
    return fail(env, "OWNERSHIP_FAILED");
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor,
                                 FALSE};
  BOOL created = CreateDirectoryW(directory.c_str(), &attributes);
  DWORD error = created ? ERROR_SUCCESS : GetLastError();
  DWORD flags = GetFileAttributesW(directory.c_str());
  BOOL present = FALSE, defaulted = FALSE;
  PACL dacl = nullptr;
  bool ok =
      (created || error == ERROR_ALREADY_EXISTS) &&
      flags != INVALID_FILE_ATTRIBUTES && (flags & FILE_ATTRIBUTE_DIRECTORY) &&
      !(flags & FILE_ATTRIBUTE_REPARSE_POINT) &&
      GetSecurityDescriptorDacl(descriptor, &present, &dacl, &defaulted) &&
      present &&
      SetNamedSecurityInfoW(directory.data(), SE_FILE_OBJECT,
                            DACL_SECURITY_INFORMATION |
                                PROTECTED_DACL_SECURITY_INFORMATION,
                            nullptr, nullptr, dacl, nullptr) == ERROR_SUCCESS;
  LocalFree(descriptor);
  return ok ? nothing(env) : fail(env, "OWNERSHIP_FAILED");
}
bool wide(napi_env env, napi_value value, std::wstring &result) {
  size_t size = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &size) != napi_ok ||
      size == 0 || size > 32700)
    return false;
  std::vector<char16_t> buffer(size + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(),
                                  &size) != napi_ok)
    return false;
  result.clear();
  result.reserve(size);
  for (size_t i = 0; i < size; ++i)
    result.push_back(static_cast<wchar_t>(buffer[i]));
  return result.find(L'\0') == std::wstring::npos;
}
/** Deny file replacement/write and ancestor rename while the verifier hashes
 * and launches. */
napi_value seal_files(napi_env env, napi_callback_info info) {
  napi_value values[1];
  bool array = false;
  uint32_t count = 0;
  if (!arguments(env, info, 1, values) ||
      napi_is_array(env, values[0], &array) != napi_ok || !array ||
      napi_get_array_length(env, values[0], &count) != napi_ok || count == 0 ||
      count > 256)
    return fail(env, "INVALID_CONTROL");
  auto files = std::make_unique<Files>();
  for (uint32_t i = 0; i < count; i++) {
    napi_value value;
    std::wstring name;
    if (napi_get_element(env, values[0], i, &value) != napi_ok ||
        !wide(env, value, name) || name.size() < 4 || name[1] != L':' ||
        name[2] != L'\\' || name.find(L':', 2) != std::wstring::npos)
      return fail(env, "INVALID_CONTROL");
    bool file = true;
    size_t depth = 0;
    for (;;) {
      if (++depth > 64)
        return fail(env, "OWNERSHIP_FAILED");
      auto handle = std::make_unique<Handle>(CreateFileW(
          name.c_str(), file ? GENERIC_READ : FILE_READ_ATTRIBUTES,
          file ? FILE_SHARE_READ : FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
          OPEN_EXISTING,
          FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
      BY_HANDLE_FILE_INFORMATION file_info{};
      if (handle->value == INVALID_HANDLE_VALUE ||
          !GetFileInformationByHandle(handle->value, &file_info) ||
          (file_info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
          (file && ((file_info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
                    file_info.nNumberOfLinks != 1)) ||
          (!file && !(file_info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)))
        return fail(env, "OWNERSHIP_FAILED");
      files->handles.push_back(std::move(handle));
      if (name.size() == 3)
        break;
      size_t slash = name.find_last_of(L'\\');
      if (slash == std::wstring::npos)
        return fail(env, "INVALID_CONTROL");
      name = name.substr(0, slash == 2 ? 3 : slash);
      file = false;
    }
  }
  return wrap(env, std::move(files), files_tag);
}
napi_value release_files(napi_env env, napi_callback_info info) {
  napi_value values[1];
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *files = unwrap<Files>(env, values[0], files_tag);
  if (!files)
    return fail(env, "INVALID_CONTROL");
  files->handles.clear();
  return nothing(env);
}
std::wstring quote(const std::wstring &text) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t c : text) {
    if (c == L'\\') {
      ++slashes;
      continue;
    }
    result.append(c == L'\"' ? slashes * 2 + 1 : slashes, L'\\');
    result += c;
    slashes = 0;
  }
  result.append(slashes * 2, L'\\');
  return result + L'\"';
}
HANDLE job() {
  Handle result(CreateJobObjectW(nullptr, nullptr));
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION policy{};
  policy.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!result.value ||
      !SetInformationJobObject(result.value, JobObjectExtendedLimitInformation,
                               &policy, sizeof(policy)))
    return nullptr;
  HANDLE value = result.value;
  result.value = nullptr;
  return value;
}
napi_value create(napi_env env, napi_callback_info info) {
  napi_value values[1];
  if (!arguments(env, info, 0, values))
    return fail(env, "INVALID_CONTROL");
  auto root = std::make_unique<Deployment>();
  root->job.reset(job());
  if (!root->job.value)
    return fail(env, "OWNERSHIP_FAILED");
  return wrap(env, std::move(root), root_tag);
}

/** Native children remain suspended until both containment assignments succeed.
 */
napi_value launch_mode(napi_env env, napi_callback_info info, bool console,
                       bool cuda = false) {
  napi_value values[5];
  if (!arguments(env, info, cuda ? 5 : console ? 4 : 3, values))
    return fail(env, "INVALID_CONTROL");
  auto *root = unwrap<Deployment>(env, values[0], root_tag);
  std::wstring executable, command, temporary, gpu;
  bool array = false;
  uint32_t length = 0;
  if (!root || !root->job.value || !wide(env, values[1], executable) ||
      napi_is_array(env, values[2], &array) != napi_ok || !array ||
      napi_get_array_length(env, values[2], &length) != napi_ok ||
      length > 64 || (console && !wide(env, values[3], temporary)))
    return fail(env, "INVALID_CONTROL");
  // Full physical UUID only. No ordinals, abbreviated UUIDs, MIG or environment
  // maps cross this launch boundary; CUDA remaps the sole visible device to 0.
  if (cuda) {
    if (!wide(env, values[4], gpu) || gpu.size() != 40 ||
        gpu.substr(0, 4) != L"GPU-")
      return fail(env, "INVALID_CONTROL");
    for (size_t i = 4; i < gpu.size(); ++i) {
      const bool hyphen = i == 12 || i == 17 || i == 22 || i == 27;
      const auto c = gpu[i];
      if (hyphen ? c != L'-'
                 : !((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f') ||
                     (c >= L'A' && c <= L'F')))
        return fail(env, "INVALID_CONTROL");
    }
  }
  command = quote(executable);
  for (uint32_t i = 0; i < length; ++i) {
    napi_value value;
    std::wstring item;
    if (napi_get_element(env, values[2], i, &value) != napi_ok ||
        !wide(env, value, item))
      return fail(env, "INVALID_CONTROL");
    command += L" " + quote(item);
  }
  if (command.size() > 32700)
    return fail(env, "INVALID_CONTROL");
  auto child = std::make_unique<Child>();
  child->job.reset(job());
  if (!child->job.value)
    return fail(env, "OWNERSHIP_FAILED");
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE in_read = nullptr, in_write = nullptr, out_read = nullptr,
         out_write = nullptr;
  if (!CreatePipe(&in_read, &in_write, &security, 4096))
    return fail(env, "OWNERSHIP_FAILED");
  Handle reader(in_read);
  child->input.reset(in_write);
  if (!CreatePipe(&out_read, &out_write, &security, 4096))
    return fail(env, "OWNERSHIP_FAILED");
  Handle writer(out_write);
  child->output.reset(out_read);
  if (!SetHandleInformation(child->input.value, HANDLE_FLAG_INHERIT, 0) ||
      !SetHandleInformation(child->output.value, HANDLE_FLAG_INHERIT, 0))
    return fail(env, "OWNERSHIP_FAILED");
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags =
      STARTF_USESTDHANDLES | (console ? STARTF_USESHOWWINDOW : 0);
  startup.StartupInfo.wShowWindow = SW_HIDE;
  startup.StartupInfo.hStdInput = reader.value;
  startup.StartupInfo.hStdOutput = writer.value;
  startup.StartupInfo.hStdError = writer.value;
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 2, 0, &bytes);
  std::vector<unsigned char> attributes(bytes);
  startup.lpAttributeList =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 2, 0, &bytes))
    return fail(env, "OWNERSHIP_FAILED");
  HANDLE inherit[] = {reader.value, writer.value};
  bool configured =
      UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit,
                                sizeof(inherit), nullptr, nullptr) != FALSE;
  HANDLE containment[] = {root->job.value, child->job.value};
  // Admission at creation closes the owner-death gap before post-create
  // assignment can run.
  configured = configured &&
               UpdateProcThreadAttribute(
                   startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                   containment, sizeof(containment), nullptr, nullptr) != FALSE;
  std::wstring directory =
      executable.substr(0, executable.find_last_of(L"\\/"));
  wchar_t windows[32768];
  if (console && !GetWindowsDirectoryW(windows, 32768)) {
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    return fail(env, "LAUNCH_FAILED");
  }
  // No inherited LLAMA_ARG, user PATH or current directory can change a real
  // launch.
  std::wstring environment;
  if (console) {
    for (const auto &item : std::vector<std::wstring>{
             L"CUDA_CACHE_PATH=" + temporary, L"CUDA_VISIBLE_DEVICES=" + gpu,
             L"PATH=" + directory + L";" + windows + L"\\System32",
             L"SystemRoot=" + std::wstring(windows), L"TEMP=" + temporary,
             L"TMP=" + temporary}) {
      environment += item;
      environment += L'\0';
    }
    environment += L'\0';
  }
  PROCESS_INFORMATION process{};
  BOOL created =
      configured &&
      CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
                     (console ? CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT
                              : CREATE_NO_WINDOW) |
                         CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT,
                     console ? environment.data() : nullptr,
                     console ? directory.c_str() : nullptr,
                     &startup.StartupInfo, &process);
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  if (!created)
    return fail(env, "LAUNCH_FAILED");
  child->process.reset(process.hProcess);
  Handle thread(process.hThread);
  child->pid = process.dwProcessId;
  BOOL in_root = FALSE, in_engine = FALSE;
  if (!IsProcessInJob(child->process.value, root->job.value, &in_root) ||
      !in_root ||
      !IsProcessInJob(child->process.value, child->job.value, &in_engine) ||
      !in_engine || ResumeThread(thread.value) == static_cast<DWORD>(-1)) {
    // On failed containment the suspended process cannot execute fixture or
    // engine code. Closing the nested kill-on-close handle contains even a
    // failed resume or observation.
    return fail(env, "OWNERSHIP_FAILED");
  }
  return wrap(env, std::move(child), child_tag);
}
napi_value launch(napi_env env, napi_callback_info info) {
  return launch_mode(env, info, false);
}
napi_value launch_console(napi_env env, napi_callback_info info) {
  return launch_mode(env, info, true);
}
napi_value launch_cuda_console(napi_env env, napi_callback_info info) {
  return launch_mode(env, info, true, true);
}

/** Startup receipt is checked once against the contained image/time, then
 * retained as a handle. */
napi_value capture_server(napi_env env, napi_callback_info info) {
  napi_value values[3];
  uint32_t pid = 0;
  std::wstring expected;
  if (!arguments(env, info, 3, values))
    return fail(env, "INVALID_CONTROL");
  auto *child = unwrap<Child>(env, values[0], child_tag);
  if (!child || !child->process.value || child->server.value ||
      napi_get_value_uint32(env, values[1], &pid) != napi_ok || !pid ||
      !wide(env, values[2], expected))
    return fail(env, "INVALID_CONTROL");
  Handle server(
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid));
  BOOL contained = FALSE;
  wchar_t image[32768];
  DWORD size = 32768;
  FILETIME owner_created{}, server_created{}, exited{}, kernel{}, user{};
  if (!server.value || WaitForSingleObject(server.value, 0) != WAIT_TIMEOUT ||
      !IsProcessInJob(server.value, child->job.value, &contained) ||
      !contained ||
      !QueryFullProcessImageNameW(server.value, 0, image, &size) ||
      _wcsicmp(image, expected.c_str()) != 0 ||
      !GetProcessTimes(child->process.value, &owner_created, &exited, &kernel,
                       &user) ||
      !GetProcessTimes(server.value, &server_created, &exited, &kernel,
                       &user) ||
      CompareFileTime(&server_created, &owner_created) < 0)
    return fail(env, "OWNERSHIP_FAILED");
  child->server.reset(server.value);
  server.value = nullptr;
  child->server_pid = pid;
  return nothing(env);
}
/** A live retained handle plus exact IPv4 loopback LISTEN ownership is
 * required. */
napi_value owned_listener(napi_env env, napi_callback_info info) {
  napi_value values[2], result;
  uint32_t port = 0;
  if (!arguments(env, info, 2, values))
    return fail(env, "INVALID_CONTROL");
  auto *child = unwrap<Child>(env, values[0], child_tag);
  if (!child || !child->server.value ||
      napi_get_value_uint32(env, values[1], &port) != napi_ok || port < 1024 ||
      port > 65535)
    return fail(env, "INVALID_CONTROL");
  bool owned = false;
  if (WaitForSingleObject(child->server.value, 0) == WAIT_TIMEOUT &&
      WaitForSingleObject(child->process.value, 0) == WAIT_TIMEOUT) {
    DWORD bytes = 0;
    GetExtendedTcpTable(nullptr, &bytes, FALSE, AF_INET,
                        TCP_TABLE_OWNER_PID_LISTENER, 0);
    if (bytes > 16 * 1024 * 1024)
      return fail(env, "OWNERSHIP_FAILED");
    std::vector<unsigned char> buffer(bytes);
    if (GetExtendedTcpTable(buffer.data(), &bytes, FALSE, AF_INET,
                            TCP_TABLE_OWNER_PID_LISTENER, 0) != NO_ERROR)
      return fail(env, "OWNERSHIP_FAILED");
    auto *table = reinterpret_cast<MIB_TCPTABLE_OWNER_PID *>(buffer.data());
    for (DWORD i = 0; i < table->dwNumEntries; ++i) {
      const auto &row = table->table[i];
      owned = owned || (row.dwOwningPid == child->server_pid &&
                        row.dwState == MIB_TCP_STATE_LISTEN &&
                        row.dwLocalAddr == htonl(INADDR_LOOPBACK) &&
                        ntohs(static_cast<u_short>(row.dwLocalPort)) == port);
    }
  }
  if (napi_get_boolean(env, owned, &result) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}
napi_value available_memory(napi_env env, napi_callback_info info) {
  napi_value values[1], result;
  MEMORYSTATUSEX status{};
  status.dwLength = sizeof(status);
  if (!arguments(env, info, 0, values) || !GlobalMemoryStatusEx(&status) ||
      napi_create_double(env, static_cast<double>(status.ullAvailPhys),
                         &result) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}

/** Resolve the OS directory without trusting PATH or caller environment values.
 */
napi_value system_directory(napi_env env, napi_callback_info info) {
  napi_value values[1], result;
  wchar_t directory[32768];
  if (!arguments(env, info, 0, values))
    return fail(env, "INVALID_CONTROL");
  const UINT length = GetSystemDirectoryW(directory, 32768);
  if (length == 0 || length >= 32768 ||
      napi_create_string_utf16(env,
                               reinterpret_cast<const char16_t *>(directory),
                               length, &result) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}

/** NVIDIA's query requires ProgramFiles on this driver; use the OS known
 * folder. */
napi_value program_directory(napi_env env, napi_callback_info info) {
  napi_value values[1], result;
  if (!arguments(env, info, 0, values))
    return fail(env, "INVALID_CONTROL");
  PWSTR directory = nullptr;
  const HRESULT status =
      SHGetKnownFolderPath(FOLDERID_ProgramFilesX64, 0, nullptr, &directory);
  const std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> owned(
      directory, &CoTaskMemFree);
  if (FAILED(status) || !directory ||
      napi_create_string_utf16(env,
                               reinterpret_cast<const char16_t *>(directory),
                               NAPI_AUTO_LENGTH, &result) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}

/** Capture only a just-forked core with matching image/time, retaining its
 * handle thereafter. */
napi_value admit(napi_env env, napi_callback_info info) {
  napi_value values[4];
  if (!arguments(env, info, 4, values))
    return fail(env, "INVALID_CONTROL");
  auto *root = unwrap<Deployment>(env, values[0], root_tag);
  uint32_t pid = 0;
  double began = 0;
  std::wstring expected;
  if (!root || !root->job.value ||
      napi_get_value_uint32(env, values[1], &pid) != napi_ok || !pid ||
      !wide(env, values[2], expected) ||
      napi_get_value_double(env, values[3], &began) != napi_ok)
    return fail(env, "INVALID_CONTROL");
  Handle process(OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE |
                                 PROCESS_QUERY_LIMITED_INFORMATION |
                                 SYNCHRONIZE,
                             FALSE, pid));
  wchar_t image[32768];
  DWORD size = 32768;
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!process.value || WaitForSingleObject(process.value, 0) != WAIT_TIMEOUT ||
      !QueryFullProcessImageNameW(process.value, 0, image, &size) ||
      !GetProcessTimes(process.value, &created, &exited, &kernel, &user))
    return fail(env, "OWNERSHIP_FAILED");
  ULARGE_INTEGER time{};
  time.LowPart = created.dwLowDateTime;
  time.HighPart = created.dwHighDateTime;
  double milliseconds =
      static_cast<double>(time.QuadPart / 10000 - 11644473600000ULL);
  if (_wcsicmp(expected.c_str(), image) != 0 || milliseconds < began ||
      !AssignProcessToJobObject(root->job.value, process.value))
    return fail(env, "OWNERSHIP_FAILED");
  root->cores.push_back(process.value);
  process.value = nullptr;
  return nothing(env);
}
napi_value close_root(napi_env env, napi_callback_info info) {
  napi_value values[1];
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *root = unwrap<Deployment>(env, values[0], root_tag);
  if (!root)
    return fail(env, "INVALID_CONTROL");
  root->job.reset();
  return nothing(env);
}
napi_value cores_exited(napi_env env, napi_callback_info info) {
  napi_value values[1], result;
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *root = unwrap<Deployment>(env, values[0], root_tag);
  if (!root)
    return fail(env, "INVALID_CONTROL");
  bool exited = true;
  for (auto core : root->cores)
    exited = exited && WaitForSingleObject(core, 0) == WAIT_OBJECT_0;
  if (napi_get_boolean(env, exited, &result) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}
bool number(napi_env env, napi_value object, const char *name, double value) {
  napi_value number_value;
  return napi_create_double(env, value, &number_value) == napi_ok &&
         napi_set_named_property(env, object, name, number_value) == napi_ok;
}
napi_value observe(napi_env env, napi_callback_info info) {
  napi_value values[1], result, output;
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *child = unwrap<Child>(env, values[0], child_tag);
  if (!child || !child->process.value)
    return fail(env, "INVALID_CONTROL");
  DWORD available = 0, read = 0;
  char buffer[4096];
  if (PeekNamedPipe(child->output.value, nullptr, 0, nullptr, &available,
                    nullptr) &&
      available > 0) {
    if (!ReadFile(child->output.value, buffer,
                  (std::min)(available, DWORD{sizeof(buffer)}), &read, nullptr))
      return fail(env, "PIPE_FAILED");
  }
  DWORD code = STILL_ACTIVE;
  bool exited = WaitForSingleObject(child->process.value, 0) == WAIT_OBJECT_0;
  if (exited && !GetExitCodeProcess(child->process.value, &code))
    return fail(env, "OWNERSHIP_FAILED");
  // A crashed parent cannot leave an unbounded descendant running after its
  // receipt.
  if (exited && child->job.value && !TerminateJobObject(child->job.value, 1))
    return fail(env, "OWNERSHIP_FAILED");
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(child->job.value,
                                 JobObjectBasicAccountingInformation,
                                 &accounting, sizeof(accounting), nullptr))
    return fail(env, "OWNERSHIP_FAILED");
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  if (!QueryInformationJobObject(child->job.value,
                                 JobObjectExtendedLimitInformation, &limits,
                                 sizeof(limits), nullptr))
    return fail(env, "OWNERSHIP_FAILED");
  bool memory_known = true;
  auto peak = [&memory_known](HANDLE process, SIZE_T &previous) {
    if (!process || WaitForSingleObject(process, 0) == WAIT_OBJECT_0)
      return;
    PROCESS_MEMORY_COUNTERS counters{};
    if (!K32GetProcessMemoryInfo(process, &counters, sizeof(counters))) {
      memory_known = false;
      return;
    }
    previous = (std::max)(previous, counters.PeakWorkingSetSize);
  };
  // Only retained, ownership-checked handles; never reopen a later PID for
  // attribution.
  peak(child->process.value, child->helper_peak_ws);
  peak(child->server.value, child->server_peak_ws);
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_string_utf8(env, buffer, read, &output) != napi_ok ||
      napi_set_named_property(env, result, "output", output) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  if (!number(env, result, "pid", child->pid) ||
      !number(env, result, "exitCode",
              exited ? static_cast<double>(code) : -1) ||
      !number(env, result, "activeProcesses", accounting.ActiveProcesses) ||
      !number(env, result, "peakJobCommit",
              static_cast<double>(limits.PeakJobMemoryUsed)) ||
      !number(env, result, "peakWorkingSet",
              memory_known ? static_cast<double>(child->helper_peak_ws +
                                                 child->server_peak_ws)
                           : -1))
    return fail(env, "OWNERSHIP_FAILED");
  return result;
}
napi_value action(napi_env env, napi_callback_info info, bool force,
                  char command) {
  napi_value values[1];
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *child = unwrap<Child>(env, values[0], child_tag);
  if (!child || !child->process.value || !child->job.value)
    return fail(env, "INVALID_CONTROL");
  if (WaitForSingleObject(child->process.value, 0) == WAIT_OBJECT_0)
    return nothing(env);
  if (force) {
    if (!TerminateJobObject(child->job.value, 1))
      return fail(env, "OWNERSHIP_FAILED");
  } else if ((command == 'S' && !child->sent_stop) ||
             (command == 'A' && !child->sent_abort)) {
    DWORD written = 0;
    if (!WriteFile(child->input.value, &command, 1, &written, nullptr) ||
        written != 1)
      return fail(env, "PIPE_FAILED");
    if (command == 'S')
      child->sent_stop = true;
    if (command == 'A')
      child->sent_abort = true;
  }
  return nothing(env);
}
napi_value stop(napi_env env, napi_callback_info info) {
  return action(env, info, false, 'S');
}
napi_value abort_child(napi_env env, napi_callback_info info) {
  return action(env, info, false, 'A');
}
napi_value force(napi_env env, napi_callback_info info) {
  return action(env, info, true, 0);
}
napi_value release(napi_env env, napi_callback_info info) {
  napi_value values[1];
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *child = unwrap<Child>(env, values[0], child_tag);
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!child || !child->process.value ||
      WaitForSingleObject(child->process.value, 0) != WAIT_OBJECT_0 ||
      !QueryInformationJobObject(child->job.value,
                                 JobObjectBasicAccountingInformation,
                                 &accounting, sizeof(accounting), nullptr) ||
      accounting.ActiveProcesses != 0)
    return fail(env, "OWNERSHIP_FAILED");
  child->job.reset();
  child->process.reset();
  child->input.reset();
  child->output.reset();
  child->server.reset();
  return nothing(env);
}
/** No C++ allocation/standard-library exception may cross the Node-API callback
 * ABI. */
template <napi_callback Callback>
napi_value checked(napi_env env, napi_callback_info info) noexcept {
  try {
    return Callback(env, info);
  } catch (...) {
    return fail(env, "OWNERSHIP_FAILED");
  }
}
} // namespace

/** Private privileged binding; opaque native objects never cross renderer or
 * utility IPC. */
NAPI_MODULE_INIT() {
  const napi_property_descriptor properties[] = {
      {"captureServer", nullptr, checked<capture_server>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"ownedListener", nullptr, checked<owned_listener>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"availableMemory", nullptr, checked<available_memory>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"systemDirectory", nullptr, checked<system_directory>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"programDirectory", nullptr, checked<program_directory>, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"privateDirectory", nullptr, checked<private_directory>, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"sealFiles", nullptr, checked<seal_files>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"releaseFiles", nullptr, checked<release_files>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"createDeployment", nullptr, checked<create>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"admitCore", nullptr, checked<admit>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"launch", nullptr, checked<launch>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"launchConsole", nullptr, checked<launch_console>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"launchCudaConsole", nullptr, checked<launch_cuda_console>, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"observe", nullptr, checked<observe>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"requestStop", nullptr, checked<stop>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"abortFixture", nullptr, checked<abort_child>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"forceStop", nullptr, checked<force>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"release", nullptr, checked<release>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"closeDeployment", nullptr, checked<close_root>, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"coresExited", nullptr, checked<cores_exited>, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  if (napi_define_properties(env, exports,
                             sizeof(properties) / sizeof(properties[0]),
                             properties) != napi_ok)
    return fail(env, "OWNERSHIP_FAILED");
  return exports;
}
