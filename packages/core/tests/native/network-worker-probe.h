// Shared restricted-worker primitives. The product entry closes diagnostic
// modes.
struct ProbeHandle {
  HANDLE value = nullptr;
  ProbeHandle() = default;
  explicit ProbeHandle(HANDLE handle) : value(handle) {}
  ProbeHandle(const ProbeHandle &) = delete;
  ProbeHandle &operator=(const ProbeHandle &) = delete;
  ~ProbeHandle() { close(); }
  void close() {
    if (value && value != INVALID_HANDLE_VALUE)
      CloseHandle(value);
    value = nullptr;
  }
};
struct ProbeChild {
  ProbeHandle process;
  DWORD pid = 0;
};
// Bounded diagnostic text only; never mixed into the opaque RPC byte stream.
std::string probe_runtime_tail;
void probe_drain_logs(HANDLE reader) {
  char buffer[4096]{};
  for (unsigned i = 0; i < 16; ++i) {
    DWORD available = 0, received = 0;
    if (!PeekNamedPipe(reader, nullptr, 0, nullptr, &available, nullptr) ||
        !available)
      return;
    if (!ReadFile(reader, buffer, std::min<DWORD>(available, sizeof(buffer)),
                  &received, nullptr) ||
        !received)
      return;
    probe_runtime_tail.append(buffer, received);
    if (probe_runtime_tail.size() > 1024)
      probe_runtime_tail.erase(0, probe_runtime_tail.size() - 1024);
  }
}
struct ProbeLogs {
  ProbeHandle read, write;
  ProbeLogs() {
    SECURITY_ATTRIBUTES inherit{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    if (!CreatePipe(&read.value, &write.value, &inherit, 65536) ||
        !SetHandleInformation(read.value, HANDLE_FLAG_INHERIT, 0))
      throw Failure{"worker-log-pipe", GetLastError()};
  }
};
struct ProbeCanary {
  ProbeHandle file;
  std::wstring path;
  explicit ProbeCanary(const std::wstring &image) {
    ProbeHandle token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token.value))
      throw Failure{"canary-token", GetLastError()};
    BYTE storage[1024]{};
    DWORD bytes = 0;
    if (!GetTokenInformation(token.value, TokenUser, storage, sizeof(storage),
                             &bytes))
      throw Failure{"canary-user", GetLastError()};
    wchar_t *user = nullptr;
    if (!ConvertSidToStringSidW(
            reinterpret_cast<TOKEN_USER *>(storage)->User.Sid, &user))
      throw Failure{"canary-sid", GetLastError()};
    const std::wstring sddl =
        L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(user) + L")";
    LocalFree(user);
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
      throw Failure{"canary-security", GetLastError()};
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor,
                                 FALSE};
    path = image + L".private-" + std::to_wstring(GetCurrentProcessId());
    file.value = CreateFileW(
        path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ, &security,
        CREATE_NEW, FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE,
        nullptr);
    const auto error = GetLastError();
    LocalFree(descriptor);
    if (file.value == INVALID_HANDLE_VALUE)
      throw Failure{"canary-create", error};
  }
};
struct ProbeDesktop {
  HWINSTA station = nullptr;
  HDESK desktop = nullptr;
  std::wstring name;
  ProbeDesktop() {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;BU)", SDDL_REVISION_1,
            &descriptor, nullptr))
      throw Failure{"desktop-security", GetLastError()};
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor,
                                 FALSE};
    const std::wstring stationName =
        L"ModelLoomProbe" + std::to_wstring(GetCurrentProcessId());
    station = CreateWindowStationW(stationName.c_str(), 0, WINSTA_ALL_ACCESS,
                                   &security);
    if (!station) {
      LocalFree(descriptor);
      throw Failure{"private-station", GetLastError()};
    }
    const auto previous = GetProcessWindowStation();
    if (SetProcessWindowStation(station)) {
      desktop = CreateDesktopW(L"Worker", nullptr, nullptr, 0, GENERIC_ALL,
                               &security);
      const auto error = GetLastError();
      if (!SetProcessWindowStation(previous)) {
        LocalFree(descriptor);
        throw Failure{"restore-station", GetLastError()};
      }
      if (!desktop) {
        LocalFree(descriptor);
        throw Failure{"private-desktop", error};
      }
    } else {
      LocalFree(descriptor);
      throw Failure{"select-station", GetLastError()};
    }
    LocalFree(descriptor);
    name = stationName + L"\\Worker";
  }
  ~ProbeDesktop() {
    if (desktop)
      CloseDesktop(desktop);
    if (station)
      CloseWindowStation(station);
  }
};
std::wstring probe_image() {
  wchar_t path[32768];
  const DWORD length = GetModuleFileNameW(nullptr, path, 32768);
  if (!length || length >= 32768)
    throw Failure{"child-image", GetLastError()};
  return std::wstring(path, length);
}
std::wstring probe_handle(HANDLE handle) {
  return std::to_wstring(reinterpret_cast<uintptr_t>(handle));
}
HANDLE probe_parse_handle(const wchar_t *text) {
  wchar_t *end = nullptr;
  const auto value = _wcstoui64(text, &end, 10);
  if (!value || !end || *end)
    throw Failure{"child-handle", ERROR_INVALID_PARAMETER};
  return reinterpret_cast<HANDLE>(static_cast<uintptr_t>(value));
}
void probe_wait(HANDLE process, const char *stage) {
  if (WaitForSingleObject(process, 5000) != WAIT_OBJECT_0)
    throw Failure{stage, ERROR_TIMEOUT};
}
bool probe_restricted(HANDLE process) {
  ProbeHandle token;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token.value))
    throw Failure{"worker-token-query", GetLastError()};
  TOKEN_ELEVATION elevation{};
  DWORD bytes = 0;
  if (!GetTokenInformation(token.value, TokenElevation, &elevation,
                           sizeof(elevation), &bytes))
    throw Failure{"worker-elevation-query", GetLastError()};
  BYTE integrityStorage[256]{};
  if (!GetTokenInformation(token.value, TokenIntegrityLevel, integrityStorage,
                           sizeof(integrityStorage), &bytes))
    throw Failure{"worker-integrity-query", GetLastError()};
  const auto integrity =
      reinterpret_cast<TOKEN_MANDATORY_LABEL *>(integrityStorage)->Label.Sid;
  const DWORD level =
      *GetSidSubAuthority(integrity, *GetSidSubAuthorityCount(integrity) - 1);
  return IsTokenRestricted(token.value) && !elevation.TokenIsElevated &&
         level <= SECURITY_MANDATORY_MEDIUM_RID;
}
HANDLE probe_restricted_token() {
  ProbeHandle original, restricted;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &original.value))
    throw Failure{"token-open", GetLastError()};
  BYTE users[SECURITY_MAX_SID_SIZE]{};
  DWORD size = sizeof(users);
  if (!CreateWellKnownSid(WinBuiltinUsersSid, nullptr, users, &size))
    throw Failure{"restricting-sid", GetLastError()};
  BYTE world[SECURITY_MAX_SID_SIZE]{};
  size = sizeof(world);
  if (!CreateWellKnownSid(WinWorldSid, nullptr, world, &size))
    throw Failure{"public-resource-sid", GetLastError()};
  PSID cache = nullptr;
  if (!ConvertStringSidToSidW(L"S-1-5-21-1610612737-1297040460-1413693768-1",
                              &cache))
    throw Failure{"cache-restricting-sid", GetLastError()};
  SID_AND_ATTRIBUTES restrictions[] = {{users, 0}, {world, 0}, {cache, 0}};
  const BOOL made = CreateRestrictedToken(
      original.value, DISABLE_MAX_PRIVILEGE | LUA_TOKEN, 0, nullptr, 0, nullptr,
      GetEnvironmentVariableW(L"MODELLOOM_TENSOR_CACHE_OWNER", nullptr, 0) == 65
          ? 3
          : 2,
      restrictions, &restricted.value);
  const DWORD tokenError = GetLastError();
  LocalFree(cache);
  if (!made)
    throw Failure{"token-restrict", tokenError};
  BYTE medium[SECURITY_MAX_SID_SIZE]{};
  size = sizeof(medium);
  if (!CreateWellKnownSid(WinMediumLabelSid, nullptr, medium, &size))
    throw Failure{"integrity-sid", GetLastError()};
  TOKEN_MANDATORY_LABEL label{{medium, SE_GROUP_INTEGRITY}};
  if (!SetTokenInformation(
          restricted.value, TokenIntegrityLevel, &label,
          static_cast<DWORD>(sizeof(label) + GetLengthSid(medium))))
    throw Failure{"token-integrity", GetLastError()};
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          L"D:P(A;;GA;;;BU)(A;;GA;;;SY)", SDDL_REVISION_1, &descriptor,
          nullptr))
    throw Failure{"token-object-security", GetLastError()};
  PACL acl = nullptr;
  BOOL present = FALSE, defaulted = FALSE;
  if (!GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted)) {
    LocalFree(descriptor);
    throw Failure{"token-object-dacl", GetLastError()};
  }
  TOKEN_DEFAULT_DACL defaultDacl{acl};
  const BOOL configured = SetTokenInformation(
      restricted.value, TokenDefaultDacl, &defaultDacl, sizeof(defaultDacl));
  const DWORD securityError = GetLastError();
  LocalFree(descriptor);
  if (!configured)
    throw Failure{"token-default-dacl", securityError};
  HANDLE result = restricted.value;
  restricted.value = nullptr;
  return result;
}
HANDLE probe_job() {
  ProbeHandle job(CreateJobObjectW(nullptr, nullptr));
  if (!job.value)
    throw Failure{"create-job", GetLastError()};
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits)))
    throw Failure{"job-limits", GetLastError()};
  HANDLE result = job.value;
  job.value = nullptr;
  return result;
}
bool probe_valid_gpu_uuid(const std::wstring &uuid) {
  if (uuid.size() != 40 || uuid.compare(0, 4, L"GPU-") != 0)
    return false;
  for (size_t i = 4; i < uuid.size(); ++i) {
    const bool dash = i == 12 || i == 17 || i == 22 || i == 27;
    if (dash ? uuid[i] != L'-'
             : !((uuid[i] >= L'0' && uuid[i] <= L'9') ||
                 (uuid[i] >= L'a' && uuid[i] <= L'f') ||
                 (uuid[i] >= L'A' && uuid[i] <= L'F')))
      return false;
  }
  return true;
}
void probe_launch(ProbeChild &child, const std::wstring &arguments,
                  const std::vector<HANDLE> &handles, HANDLE job, bool resume,
                  bool restrictWorker = false,
                  const std::wstring &desktop = L"", bool stockRpc = false,
                  bool cudaStock = false, HANDLE output = nullptr,
                  HANDLE cacheRoot = nullptr) {
  const auto self = probe_image();
  // Only this fixed diagnostic asset is permitted, never an arbitrary image.
  const auto image = stockRpc ? self.substr(0, self.find_last_of(L"\\/")) +
#ifdef MODELLOOM_PEER_HOST
                                    L"\\ggml-rpc-server.exe"
#else
                                    (cudaStock
                                         ? L"\\stock-rpc-gpu\\ggml-rpc-server."
                                           L"exe"
                                         : L"\\stock-rpc\\ggml-rpc-server.exe")
#endif
                              : self;
  std::wstring command = L"\"" + image + L"\" " + arguments;
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  if (output) {
    startup.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
    startup.StartupInfo.hStdOutput = output;
    startup.StartupInfo.hStdError = output;
  }
  if (!desktop.empty())
    startup.StartupInfo.lpDesktop = const_cast<wchar_t *>(desktop.c_str());
  SIZE_T bytes = 0;
  auto inheritedHandles = handles;
  if (cacheRoot)
    inheritedHandles.push_back(cacheRoot);
  InitializeProcThreadAttributeList(nullptr, 2, 0, &bytes);
  std::vector<unsigned char> storage(bytes);
  startup.lpAttributeList =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 2, 0, &bytes))
    throw Failure{"child-attributes", GetLastError()};
  const bool attributes =
      UpdateProcThreadAttribute(
          startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
          inheritedHandles.data(), inheritedHandles.size() * sizeof(HANDLE),
          nullptr, nullptr) &&
      UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                                PROC_THREAD_ATTRIBUTE_JOB_LIST, &job,
                                sizeof(job), nullptr, nullptr);
  PROCESS_INFORMATION process{};
  ProbeHandle restricted;
  std::vector<wchar_t> environment;
  const auto directory = image.substr(0, image.find_last_of(L"\\/"));
  if (restrictWorker)
    restricted.value = probe_restricted_token();
  if (restrictWorker) {
    wchar_t windows[32768]{}, system[32768]{};
    if (!GetWindowsDirectoryW(windows, 32768) ||
        !GetSystemDirectoryW(system, 32768))
      throw Failure{"worker-system-paths", GetLastError()};
    std::vector<std::wstring> values = {
        L"SystemRoot=" + std::wstring(windows),
        L"PATH=" + std::wstring(system),
        L"TEMP=" + std::wstring(windows) + L"\\Temp",
        L"TMP=" + std::wstring(windows) + L"\\Temp",
        L"CUDA_CACHE_DISABLE=1",
        L"GGML_RPC_NO_RDMA=1"};
    for (const auto name :
         {L"MODELLOOM_TENSOR_CACHE", L"MODELLOOM_TENSOR_CACHE_LIMIT",
          L"MODELLOOM_TENSOR_CACHE_RESERVE", L"MODELLOOM_TENSOR_CACHE_REPLACE",
          L"MODELLOOM_TENSOR_CACHE_OWNER"}) {
      wchar_t value[4096]{};
      const DWORD length = GetEnvironmentVariableW(name, value, 4096);
      if (length >= 4096)
        throw Failure{"worker-cache-policy", ERROR_INVALID_DATA};
      if (length)
        values.push_back(std::wstring(name) + L"=" + value);
    }
    if (cacheRoot)
      values.push_back(L"MODELLOOM_TENSOR_CACHE_ROOT_HANDLE=" +
                       std::to_wstring(reinterpret_cast<uintptr_t>(cacheRoot)));
    if (cudaStock) {
      wchar_t uuid[64]{};
      if (GetEnvironmentVariableW(L"MODELLOOM_PROBE_GPU_UUID", uuid, 64) !=
              40 ||
          !probe_valid_gpu_uuid(uuid))
        throw Failure{"worker-gpu-uuid", ERROR_INVALID_PARAMETER};
#ifdef MODELLOOM_VULKAN_HOST
      values.push_back(L"GGML_VK_VISIBLE_DEVICES=" + modelloom::vulkan_devices(uuid));
      values.push_back(L"VK_LOADER_LAYERS_DISABLE=~implicit~");
#else
      values.push_back(L"CUDA_VISIBLE_DEVICES=" + std::wstring(uuid));
#endif
    }
    std::sort(values.begin(), values.end());
    for (const auto &value : values) {
      environment.insert(environment.end(), value.begin(), value.end());
      environment.push_back(L'\0');
    }
    environment.push_back(L'\0');
  }
  const DWORD flags = CREATE_NO_WINDOW | CREATE_SUSPENDED |
                      EXTENDED_STARTUPINFO_PRESENT |
                      (restrictWorker ? CREATE_UNICODE_ENVIRONMENT : 0);
  const BOOL created =
      attributes &&
      (restrictWorker ? CreateProcessAsUserW(
                            restricted.value, image.c_str(), command.data(),
                            nullptr, nullptr, TRUE, flags, environment.data(),
                            directory.c_str(), &startup.StartupInfo, &process)
                      : CreateProcessW(image.c_str(), command.data(), nullptr,
                                       nullptr, TRUE, flags, nullptr, nullptr,
                                       &startup.StartupInfo, &process));
  const DWORD error = GetLastError();
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  if (!created)
    throw Failure{"child-create", error};
  child.process.value = process.hProcess;
  child.pid = process.dwProcessId;
  ProbeHandle thread(process.hThread);
  if (resume && ResumeThread(thread.value) == static_cast<DWORD>(-1))
    throw Failure{"child-resume", GetLastError()};
}
int probe_fixture(int argc, wchar_t **argv) {
  if (argc != 7)
    return 2;
  ProbeHandle progressHandle(probe_parse_handle(argv[5]));
  auto *progress = static_cast<volatile LONG *>(
      MapViewOfFile(progressHandle.value, FILE_MAP_WRITE, 0, 0, sizeof(LONG)));
  if (!progress)
    throw Failure{"fixture-progress-map", GetLastError()};
  *progress = 1;
  if (!probe_restricted(GetCurrentProcess()))
    throw Failure{"fixture-not-restricted", ERROR_ACCESS_DENIED};
  const std::wstring privatePath =
      probe_image() + L".private-" + std::to_wstring(parent_pid(argv[6]));
  ProbeHandle denied(
      CreateFileW(privatePath.c_str(), GENERIC_READ,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING, 0, nullptr));
  if (denied.value != INVALID_HANDLE_VALUE ||
      GetLastError() != ERROR_ACCESS_DENIED)
    throw Failure{"fixture-private-file-not-denied", ERROR_INVALID_STATE};
  *progress = 2;
  WSADATA data{};
  check(static_cast<DWORD>(WSAStartup(MAKEWORD(2, 2), &data)),
        "fixture-winsock");
  *progress = 3;
  Socket listener;
  listener.value = reinterpret_cast<SOCKET>(probe_parse_handle(argv[2]));
  ProbeHandle ready(probe_parse_handle(argv[3])),
      stop(probe_parse_handle(argv[4]));
  if (listen(listener.value, 8))
    throw Failure{"fixture-listen", static_cast<DWORD>(WSAGetLastError())};
  *progress = 4;
  if (!SetEvent(ready.value))
    throw Failure{"fixture-ready", GetLastError()};
  *progress = 5;
  const DWORD waited = WaitForSingleObject(stop.value, 30000);
  listener.close();
  WSACleanup();
  UnmapViewOfFile(const_cast<LONG *>(progress));
  return waited == WAIT_OBJECT_0 ? 0 : 3;
}
int probe_owner(int argc, wchar_t **argv) {
  if (argc != 9)
    return 2;
  WSADATA data{};
  check(static_cast<DWORD>(WSAStartup(MAKEWORD(2, 2), &data)), "owner-winsock");
  struct OwnerWinsock {
    ~OwnerWinsock() { WSACleanup(); }
  } ownerWinsock;
  Socket listener;
  listener.value = reinterpret_cast<SOCKET>(probe_parse_handle(argv[2]));
  ProbeHandle ready(probe_parse_handle(argv[3])),
      stop(probe_parse_handle(argv[4])), control(probe_parse_handle(argv[5])),
      report(probe_parse_handle(argv[6]));
  ProbeHandle progress(probe_parse_handle(argv[8]));
  const bool startupFailure = std::wstring(argv[7]) == L"fail";
  if (!startupFailure && std::wstring(argv[7]) != L"run")
    return 2;
  ProbeHandle job(probe_job());
  ProbeDesktop desktop;
  ProbeCanary privateCanary(probe_image());
  ProbeChild worker;
  const std::wstring arguments =
      L"--fixture " + probe_handle(reinterpret_cast<HANDLE>(listener.value)) +
      L" " + probe_handle(ready.value) + L" " + probe_handle(stop.value) +
      L" " + probe_handle(progress.value) + L" " +
      std::to_wstring(GetCurrentProcessId());
  probe_launch(worker, arguments,
               {reinterpret_cast<HANDLE>(listener.value), ready.value,
                stop.value, progress.value},
               job.value, !startupFailure, true, desktop.name);
  listener.close();
  DWORD written = 0;
  if (!WriteFile(report.value, &worker.pid, sizeof(worker.pid), &written,
                 nullptr) ||
      written != sizeof(worker.pid))
    throw Failure{"worker-report", GetLastError()};
  report.close();
  if (startupFailure) {
    probe_wait(stop.value, "startup-stop");
    if (!TerminateJobObject(job.value, 21))
      throw Failure{"startup-rollback", GetLastError()};
    probe_wait(worker.process.value, "startup-worker-exit");
    return 21;
  }
  const ULONGLONG deadline = GetTickCount64() + 25000;
  while (GetTickCount64() < deadline) {
    DWORD bytes = 0;
    if (!PeekNamedPipe(control.value, nullptr, 0, nullptr, &bytes, nullptr))
      break;
    if (bytes) {
      char command = 0;
      DWORD count = 0;
      if (!ReadFile(control.value, &command, 1, &count, nullptr) || count != 1)
        break;
      if (command == 'C') {
        if (!TerminateProcess(GetCurrentProcess(), 12))
          throw Failure{"owner-crash", GetLastError()};
        Sleep(INFINITE);
      }
      if (command != 'S')
        throw Failure{"owner-command", ERROR_INVALID_DATA};
      break;
    }
    Sleep(10);
  }
  if (!SetEvent(stop.value))
    throw Failure{"worker-stop", GetLastError()};
  probe_wait(worker.process.value, "worker-exit");
  return 0;
}
bool probe_filters_exist(HANDLE engine, const std::vector<UINT64> &ids) {
  for (const auto id : ids) {
    FWPM_FILTER0 *filter = nullptr;
    const DWORD result = FwpmFilterGetById0(engine, id, &filter);
    if (filter)
      FwpmFreeMemory0(reinterpret_cast<void **>(&filter));
    if (result != ERROR_SUCCESS)
      return false;
  }
  return true;
}
struct ProbeRules {
  Engine engine;
  std::vector<UINT64> ids;
  bool safeToRemove = true;
  ~ProbeRules() {
    if (safeToRemove)
      for (const auto id : ids)
        FwpmFilterDeleteById0(engine.value, id);
  }
};
bool probe_recover_rules(const ProbeRules &guard, HANDLE owner, HANDLE worker,
                         HANDLE job, UINT16 expectedPort,
                         bool required = false) {
  if (WaitForSingleObject(owner, 0) != WAIT_OBJECT_0 ||
      WaitForSingleObject(worker, 0) != WAIT_OBJECT_0) {
    if (required)
      throw Failure{"recovery-process-not-exited", ERROR_INVALID_STATE};
    return false;
  }
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                                 &accounting, sizeof(accounting), nullptr))
    throw Failure{"recovery-job-query", GetLastError()};
  if (accounting.ActiveProcesses) {
    if (required)
      throw Failure{"recovery-job-not-empty", accounting.ActiveProcesses};
    return false;
  }
  Engine recovery;
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr,
                        &recovery.value),
        "recovery-open");
  FWP_BYTE_BLOB *app = nullptr;
  check(FwpmGetAppIdFromFileName0(probe_image().c_str(), &app),
        "recovery-app-id");
  bool valid = guard.ids.size() == 2;
  for (const auto id : guard.ids) {
    FWPM_FILTER0 *filter = nullptr;
    const auto result = FwpmFilterGetById0(recovery.value, id, &filter);
    bool portMatches = false, appMatches = false, protocolMatches = false,
         addressMatches = false;
    DWORD addressType = 999;
    if (result == ERROR_SUCCESS && filter && filter->numFilterConditions == 4 &&
        filter->action.type == FWP_ACTION_BLOCK &&
        !(filter->flags & FWPM_FILTER_FLAG_PERSISTENT) &&
        (IsEqualGUID(filter->layerKey, FWPM_LAYER_ALE_AUTH_CONNECT_V4) ||
         IsEqualGUID(filter->layerKey, FWPM_LAYER_ALE_AUTH_CONNECT_V6))) {
      for (UINT32 i = 0; i < filter->numFilterConditions; ++i) {
        const auto &condition = filter->filterCondition[i];
        const auto &value = condition.conditionValue;
        if (IsEqualGUID(condition.fieldKey, FWPM_CONDITION_IP_REMOTE_PORT))
          portMatches = condition.matchType == FWP_MATCH_EQUAL &&
                        value.type == FWP_UINT16 &&
                        value.uint16 == expectedPort;
        else if (IsEqualGUID(condition.fieldKey, FWPM_CONDITION_IP_PROTOCOL))
          protocolMatches = condition.matchType == FWP_MATCH_EQUAL &&
                            value.type == FWP_UINT8 &&
                            value.uint8 == IPPROTO_TCP;
        else if (IsEqualGUID(condition.fieldKey, FWPM_CONDITION_ALE_APP_ID))
          appMatches = condition.matchType == FWP_MATCH_NOT_EQUAL &&
                       value.type == FWP_BYTE_BLOB_TYPE && value.byteBlob &&
                       value.byteBlob->size == app->size &&
                       !std::memcmp(value.byteBlob->data, app->data, app->size);
        else if (IsEqualGUID(condition.fieldKey,
                             FWPM_CONDITION_IP_REMOTE_ADDRESS) &&
                 condition.matchType == FWP_MATCH_EQUAL) {
          addressType = static_cast<DWORD>(value.type);
          if (value.type == FWP_V4_ADDR_MASK && value.v4AddrMask)
            addressMatches = value.v4AddrMask->addr == 0x7f000001 &&
                             value.v4AddrMask->mask == 0xffffffff;
          else if (value.type == FWP_V6_ADDR_MASK && value.v6AddrMask) {
            BYTE mapped[16]{};
            mapped[10] = mapped[11] = 0xff;
            mapped[12] = 127;
            mapped[15] = 1;
            addressMatches =
                value.v6AddrMask->prefixLength == 128 &&
                !std::memcmp(value.v6AddrMask->addr, mapped, sizeof(mapped));
          }
        }
      }
    }
    valid =
        valid && portMatches && appMatches && protocolMatches && addressMatches;
    if (filter)
      FwpmFreeMemory0(reinterpret_cast<void **>(&filter));
    if (!appMatches || !protocolMatches || !addressMatches) {
      FwpmFreeMemory0(reinterpret_cast<void **>(&app));
      throw Failure{"recovery-predicate",
                    (appMatches ? 1u : 0u) + (protocolMatches ? 2u : 0u) +
                        (addressMatches ? 4u : 0u) + 1000u * addressType};
    }
    if (required && !portMatches) {
      FwpmFreeMemory0(reinterpret_cast<void **>(&app));
      throw Failure{"recovery-port-mismatch",
                    id > UINT32_MAX ? UINT32_MAX : static_cast<DWORD>(id)};
    }
  }
  FwpmFreeMemory0(reinterpret_cast<void **>(&app));
  if (!valid)
    return false;
  check(FwpmTransactionBegin0(recovery.value, 0), "recovery-transaction");
  try {
    for (const auto id : guard.ids)
      check(FwpmFilterDeleteById0(recovery.value, id), "recovery-delete");
    check(FwpmTransactionCommit0(recovery.value), "recovery-commit");
  } catch (...) {
    FwpmTransactionAbort0(recovery.value);
    throw;
  }
  return removed(guard.ids);
}
struct ProbeContainment {
  ProbeHandle job;
  bool &safeToRemove;
  bool pinsCacheDirectory;
  explicit ProbeContainment(bool &safe, bool cachePins = false)
      : job(probe_job()), safeToRemove(safe), pinsCacheDirectory(cachePins) {}
  ~ProbeContainment() {
    if (!job.value)
      return;
    TerminateJobObject(job.value, 23);
    const ULONGLONG deadline = GetTickCount64() + 5000;
    do {
      JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
      if (QueryInformationJobObject(job.value,
                                    JobObjectBasicAccountingInformation,
                                    &accounting, sizeof(accounting), nullptr) &&
          !accounting.ActiveProcesses) {
        safeToRemove = true;
        return;
      }
      // A cache-capable worker must not outlive its helper's ancestor pins.
      // After the ordinary cleanup deadline, quarantine this helper with its
      // exact job until exit is confirmed. Its owner retains the bounded
      // abnormal-exit backstop; no new worker can be admitted here.
      Sleep(GetTickCount64() < deadline ? 10 : 100);
    } while (pinsCacheDirectory || GetTickCount64() < deadline);
  }
};
void probe_connect(UINT16 port) {
  Socket client;
  client.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (client.value == INVALID_SOCKET)
    throw Failure{"check-socket", static_cast<DWORD>(WSAGetLastError())};
  u_long nonblocking = 1;
  if (ioctlsocket(client.value, FIONBIO, &nonblocking))
    throw Failure{"check-mode", static_cast<DWORD>(WSAGetLastError())};
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(port);
  if (connect(client.value, reinterpret_cast<sockaddr *>(&address),
              sizeof(address))) {
    if (WSAGetLastError() != WSAEWOULDBLOCK)
      throw Failure{"check-connect", static_cast<DWORD>(WSAGetLastError())};
    fd_set writable, failed;
    FD_ZERO(&writable);
    FD_ZERO(&failed);
    FD_SET(client.value, &writable);
    FD_SET(client.value, &failed);
    timeval timeout{3, 0};
    if (select(0, nullptr, &writable, &failed, &timeout) <= 0 ||
        FD_ISSET(client.value, &failed))
      throw Failure{"check-connect-wait", ERROR_TIMEOUT};
    int error = 0, length = sizeof(error);
    if (getsockopt(client.value, SOL_SOCKET, SO_ERROR,
                   reinterpret_cast<char *>(&error), &length) ||
        error)
      throw Failure{"check-connect-error",
                    static_cast<DWORD>(error ? error : WSAGetLastError())};
  }
  linger reset{1, 0};
  if (setsockopt(client.value, SOL_SOCKET, SO_LINGER,
                 reinterpret_cast<char *>(&reset), sizeof(reset)))
    throw Failure{"check-close", static_cast<DWORD>(WSAGetLastError())};
}
void probe_round(Pipe &pipe, const std::string &scenario, HANDLE sentinel) {
  // Static (not persistent) rules survive session/owner exit. Cleanup runs only
  // after the job closes.
  ProbeRules guard;
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr,
                        &guard.engine.value),
        "static-open");
  WSADATA data{};
  check(static_cast<DWORD>(WSAStartup(MAKEWORD(2, 2), &data)), "round-winsock");
  struct WinsockCleanup {
    ~WinsockCleanup() { WSACleanup(); }
  } winsockCleanup;
  Socket listener;
  listener.value = WSASocketW(AF_INET, SOCK_STREAM, IPPROTO_TCP, nullptr, 0, 0);
  if (listener.value == INVALID_SOCKET)
    throw Failure{"round-socket", static_cast<DWORD>(WSAGetLastError())};
  BOOL exclusive = TRUE;
  if (setsockopt(listener.value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                 reinterpret_cast<const char *>(&exclusive), sizeof(exclusive)))
    throw Failure{"round-exclusive", static_cast<DWORD>(WSAGetLastError())};
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(listener.value, reinterpret_cast<sockaddr *>(&address),
           sizeof(address)))
    throw Failure{"round-bind", static_cast<DWORD>(WSAGetLastError())};
  int length = sizeof(address);
  if (getsockname(listener.value, reinterpret_cast<sockaddr *>(&address),
                  &length))
    throw Failure{"round-port", static_cast<DWORD>(WSAGetLastError())};
  const auto port = ntohs(address.sin_port);
  check(FwpmTransactionBegin0(guard.engine.value, 0), "static-transaction");
  try {
    guard.ids = filters(guard.engine.value, port);
    check(FwpmTransactionCommit0(guard.engine.value), "static-commit");
  } catch (...) {
    FwpmTransactionAbort0(guard.engine.value);
    guard.ids.clear();
    throw;
  }
  check(FwpmEngineClose0(guard.engine.value), "static-session-close");
  guard.engine.value = nullptr;
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr,
                        &guard.engine.value),
        "static-reopen");
  if (!probe_filters_exist(guard.engine.value, guard.ids))
    throw Failure{"static-retention", ERROR_INVALID_STATE};
  SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  ProbeHandle ready(CreateEventW(&inheritable, TRUE, FALSE, nullptr)),
      stop(CreateEventW(&inheritable, TRUE, FALSE, nullptr));
  if (!ready.value || !stop.value)
    throw Failure{"events", GetLastError()};
  ProbeHandle progress(CreateFileMappingW(INVALID_HANDLE_VALUE, &inheritable,
                                          PAGE_READWRITE, 0, 4096, nullptr));
  if (!progress.value)
    throw Failure{"progress-create", GetLastError()};
  HANDLE controlRead = nullptr, controlWrite = nullptr, reportRead = nullptr,
         reportWrite = nullptr;
  if (!CreatePipe(&controlRead, &controlWrite, &inheritable, 128))
    throw Failure{"control-create", GetLastError()};
  ProbeHandle controlReader(controlRead), controlWriter(controlWrite);
  if (!CreatePipe(&reportRead, &reportWrite, &inheritable, 128))
    throw Failure{"report-create", GetLastError()};
  ProbeHandle reportReader(reportRead), reportWriter(reportWrite);
  if (!SetHandleInformation(controlWriter.value, HANDLE_FLAG_INHERIT, 0) ||
      !SetHandleInformation(reportReader.value, HANDLE_FLAG_INHERIT, 0))
    throw Failure{"pipe-inherit", GetLastError()};
  ProbeContainment rootJob(guard.safeToRemove);
  ProbeChild owner;
  const std::wstring arguments =
      L"--owner " + probe_handle(reinterpret_cast<HANDLE>(listener.value)) +
      L" " + probe_handle(ready.value) + L" " + probe_handle(stop.value) +
      L" " + probe_handle(controlReader.value) + L" " +
      probe_handle(reportWriter.value) +
      (scenario == "startup-failure" ? L" fail" : L" run") + L" " +
      probe_handle(progress.value);
  guard.safeToRemove = false;
  probe_launch(owner, arguments,
               {reinterpret_cast<HANDLE>(listener.value), ready.value,
                stop.value, controlReader.value, reportWriter.value,
                progress.value},
               rootJob.job.value, true);
  listener.close();
  controlReader.close();
  reportWriter.close();
  DWORD childPid = 0, received = 0;
  const ULONGLONG reportDeadline = GetTickCount64() + 5000;
  DWORD available = 0;
  while (!available && GetTickCount64() < reportDeadline) {
    if (!PeekNamedPipe(reportReader.value, nullptr, 0, nullptr, &available,
                       nullptr))
      throw Failure{"worker-pid-pipe", GetLastError()};
    if (!available)
      Sleep(10);
  }
  if (available < sizeof(childPid) ||
      !ReadFile(reportReader.value, &childPid, sizeof(childPid), &received,
                nullptr) ||
      received != sizeof(childPid))
    throw Failure{"worker-pid", ERROR_TIMEOUT};
  ProbeHandle worker(OpenProcess(
      SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, childPid));
  if (!worker.value)
    throw Failure{"worker-capture", GetLastError()};
  BOOL contained = FALSE;
  if (!IsProcessInJob(worker.value, rootJob.job.value, &contained) ||
      !contained)
    throw Failure{"worker-job", ERROR_INVALID_STATE};
  if (probe_recover_rules(guard, owner.process.value, worker.value,
                          rootJob.job.value, port))
    throw Failure{"recovery-removed-live-guard", ERROR_INVALID_STATE};
  if (scenario != "startup-failure") {
    HANDLE readiness[] = {ready.value, worker.value};
    const DWORD readyState = WaitForMultipleObjects(2, readiness, FALSE, 5000);
    if (readyState == WAIT_OBJECT_0 + 1) {
      DWORD code = 0;
      GetExitCodeProcess(worker.value, &code);
      throw Failure{"worker-exited-before-ready", code};
    }
    if (readyState != WAIT_OBJECT_0) {
      const auto *phase = static_cast<const LONG *>(
          MapViewOfFile(progress.value, FILE_MAP_READ, 0, 0, sizeof(LONG)));
      const DWORD observed = phase ? static_cast<DWORD>(*phase) : 999;
      if (phase)
        UnmapViewOfFile(phase);
      throw Failure{"worker-ready-progress", 10000 + observed};
    }
    probe_connect(port);
  }
  pipe.report("{\"phase\":\"worker-ready\",\"scenario\":\"" + scenario +
              "\",\"ownConnectionAllowed\":" +
              (scenario == "startup-failure" ? "false" : "true") +
              ",\"workerRestricted\":" +
              (probe_restricted(worker.value) ? "true" : "false") +
              ",\"privateFileDenied\":" +
              (scenario == "startup-failure" ? "false" : "true") +
              ",\"port\":" + std::to_string(port) + "}");
  if (wait_for_stop(pipe.value) != 'S')
    throw Failure{"round-command", ERROR_INVALID_DATA};
  if (scenario == "startup-failure")
    SetEvent(stop.value);
  else if (scenario == "app-exit")
    controlWriter.close();
  else if (scenario != "startup-failure") {
    const char command = scenario == "helper-crash" ? 'C' : 'S';
    DWORD count = 0;
    if (!WriteFile(controlWriter.value, &command, 1, &count, nullptr) ||
        count != 1)
      throw Failure{"round-stop", GetLastError()};
  }
  probe_wait(owner.process.value, "owner-exit");
  probe_wait(worker.value, "captured-worker-exit");
  DWORD exitCode = 0;
  if (!GetExitCodeProcess(owner.process.value, &exitCode) ||
      exitCode != (scenario == "helper-crash"      ? 12u
                   : scenario == "startup-failure" ? 21u
                                                   : 0u))
    throw Failure{"owner-exit-code", ERROR_INVALID_STATE};
  if (!probe_filters_exist(guard.engine.value, guard.ids))
    throw Failure{"guard-lost-before-confirmation", ERROR_INVALID_STATE};
  // Retained process handles may signal before every owned descendant has
  // settled. Keep the static guard and resolve the complete job before
  // recovery.
  if (!TerminateJobObject(rootJob.job.value, 23))
    throw Failure{"recovery-stop-owned-job", GetLastError()};
  const ULONGLONG settleDeadline = GetTickCount64() + 5000;
  for (;;) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION settled{};
    if (!QueryInformationJobObject(rootJob.job.value,
                                   JobObjectBasicAccountingInformation,
                                   &settled, sizeof(settled), nullptr))
      throw Failure{"recovery-settle-query", GetLastError()};
    if (!settled.ActiveProcesses)
      break;
    if (GetTickCount64() >= settleDeadline)
      throw Failure{"recovery-settle-timeout", ERROR_TIMEOUT};
    Sleep(10);
  }
  if (WaitForSingleObject(sentinel, 0) != WAIT_TIMEOUT)
    throw Failure{"unrelated-process", ERROR_INVALID_STATE};
  if (probe_recover_rules(
          guard, owner.process.value, worker.value, rootJob.job.value,
          static_cast<UINT16>(port == 65535 ? port - 1 : port + 1)))
    throw Failure{"recovery-accepted-wrong-scope", ERROR_INVALID_STATE};
  if (!probe_filters_exist(guard.engine.value, guard.ids))
    throw Failure{"recovery-touched-mismatched-scope", ERROR_INVALID_STATE};
  check(FwpmEngineClose0(guard.engine.value),
        "recovery-close-original-session");
  guard.engine.value = nullptr;
  if (!probe_recover_rules(guard, owner.process.value, worker.value,
                           rootJob.job.value, port, true))
    throw Failure{"recovery-unconfirmed", ERROR_INVALID_STATE};
  guard.ids.clear();
  pipe.report("{\"phase\":\"worker-stopped\",\"scenario\":\"" + scenario +
              "\",\"workerExited\":true,\"guardRetainedUntilExit\":true,"
              "\"filtersRemoved\":true,\"unrelatedProcessAlive\":true,"
              "\"freshSessionRecovery\":true,\"liveRecoveryDenied\":true,"
              "\"mismatchedRecoveryDenied\":true}");
}
int probe_workers(Pipe &pipe) {
  SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  ProbeHandle sentinelStop(CreateEventW(&inheritable, TRUE, FALSE, nullptr)),
      sentinelJob(probe_job());
  if (!sentinelStop.value)
    throw Failure{"sentinel-event", GetLastError()};
  ProbeChild sentinel;
  probe_launch(sentinel, L"--sentinel " + probe_handle(sentinelStop.value),
               {sentinelStop.value}, sentinelJob.value, true);
  for (const auto &scenario :
       {"normal", "app-exit", "helper-crash", "startup-failure"})
    probe_round(pipe, scenario, sentinel.process.value);
  if (!SetEvent(sentinelStop.value))
    throw Failure{"sentinel-stop", GetLastError()};
  probe_wait(sentinel.process.value, "sentinel-exit");
  return 0;
}
