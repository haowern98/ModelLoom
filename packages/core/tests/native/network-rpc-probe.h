#include "../../native/tensor-cache-directory.h"
#include "../../native/tensor-cache-policy.h"
#include <memory>
// Bounded stock protocol check. No weights, allocations, graph execution or
// WAN.
bool probe_rpc_listener(UINT16 port, DWORD pid) {
  DWORD bytes = 0;
  if (GetExtendedTcpTable(nullptr, &bytes, FALSE, AF_INET,
                          TCP_TABLE_OWNER_PID_LISTENER,
                          0) != ERROR_INSUFFICIENT_BUFFER)
    throw Failure{"rpc-listener-size", GetLastError()};
  std::vector<BYTE> storage(bytes);
  check(GetExtendedTcpTable(storage.data(), &bytes, FALSE, AF_INET,
                            TCP_TABLE_OWNER_PID_LISTENER, 0),
        "rpc-listener-table");
  const auto *table =
      reinterpret_cast<const MIB_TCPTABLE_OWNER_PID *>(storage.data());
  for (DWORD i = 0; i < table->dwNumEntries; ++i) {
    const auto &row = table->table[i];
    if (ntohs(static_cast<u_short>(row.dwLocalPort)) == port) {
      if (row.dwOwningPid != pid || row.dwLocalAddr != htonl(INADDR_LOOPBACK))
        throw Failure{"rpc-listener-owner", ERROR_ACCESS_DENIED};
      return true;
    }
  }
  return false;
}
void probe_rpc_bytes(SOCKET socket, void *data, size_t bytes, bool receive) {
  auto *cursor = static_cast<char *>(data);
  while (bytes) {
    const auto count = receive
                           ? recv(socket, cursor, static_cast<int>(bytes), 0)
                           : send(socket, cursor, static_cast<int>(bytes), 0);
    if (count <= 0)
      throw Failure{"rpc-protocol-io", static_cast<DWORD>(WSAGetLastError())};
    cursor += count;
    bytes -= count;
  }
}
void probe_rpc_command(SOCKET socket, uint8_t command, void *input,
                       uint64_t inputSize, void *output, uint64_t outputSize) {
  probe_rpc_bytes(socket, &command, sizeof(command), false);
  probe_rpc_bytes(socket, &inputSize, sizeof(inputSize), false);
  if (inputSize)
    probe_rpc_bytes(socket, input, static_cast<size_t>(inputSize), false);
  uint64_t size = 0;
  probe_rpc_bytes(socket, &size, sizeof(size), true);
  if (size != outputSize)
    throw Failure{"rpc-response-size", ERROR_INVALID_DATA};
  probe_rpc_bytes(socket, output, static_cast<size_t>(outputSize), true);
}
int probe_rpc(Pipe &pipe, bool crashOwner = false, bool instance = false,
              bool relay = false, bool cuda = false) {
  std::unique_ptr<modelloom::tensor_cache::pinned_directory> cacheDirectory;
  ProbeHandle cacheRoot;
  bool cacheUnavailable = false;
  wchar_t cachePath[4096]{};
  const DWORD cacheLength =
      GetEnvironmentVariableW(L"MODELLOOM_TENSOR_CACHE", cachePath, 4096);
  if (cacheLength) {
    try {
      if (cacheLength >= 4096)
        throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
      cacheDirectory =
          std::make_unique<modelloom::tensor_cache::pinned_directory>(
              cachePath);
      cacheRoot.value = cacheDirectory->inherit_root();
    } catch (...) {
      cacheUnavailable = true;
      modelloom::apply_cache_policy(nullptr, 0);
    }
  }
  WSADATA data{};
  check(static_cast<DWORD>(WSAStartup(MAKEWORD(2, 2), &data)), "rpc-winsock");
  struct CleanupWinsock {
    ~CleanupWinsock() { WSACleanup(); }
  } winsock;
  Socket reserved;
  reserved.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (reserved.value == INVALID_SOCKET)
    throw Failure{"rpc-socket", static_cast<DWORD>(WSAGetLastError())};
  BOOL exclusive = TRUE;
  if (setsockopt(reserved.value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                 reinterpret_cast<const char *>(&exclusive), sizeof(exclusive)))
    throw Failure{"rpc-exclusive", static_cast<DWORD>(WSAGetLastError())};
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(reserved.value, reinterpret_cast<sockaddr *>(&address),
           sizeof(address)))
    throw Failure{"rpc-bind", static_cast<DWORD>(WSAGetLastError())};
  int addressSize = sizeof(address);
  if (getsockname(reserved.value, reinterpret_cast<sockaddr *>(&address),
                  &addressSize))
    throw Failure{"rpc-address", static_cast<DWORD>(WSAGetLastError())};
  const auto port = ntohs(address.sin_port);
  Socket client;
  UINT16 sourcePort = 0;
  if (instance) {
    client.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in source{};
    source.sin_family = AF_INET;
    source.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int bytes = sizeof(source);
    if (client.value == INVALID_SOCKET ||
        setsockopt(client.value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                   reinterpret_cast<const char *>(&exclusive),
                   sizeof(exclusive)) ||
        bind(client.value, reinterpret_cast<sockaddr *>(&source),
             sizeof(source)) ||
        getsockname(client.value, reinterpret_cast<sockaddr *>(&source),
                    &bytes))
      throw Failure{"instance-source-bind",
                    static_cast<DWORD>(WSAGetLastError())};
    sourcePort = ntohs(source.sin_port);
  }
  ProbeRecoveryRecord record{};
  ProbeHandle recoveryJob;
  if (crashOwner) {
    probe_record_owner(record, port);
    if (instance) {
      record.version = 2;
      record.source = sourcePort;
    }
    recoveryJob.value = probe_recovery_create_job(record);
  }
  ProbeRules guard;
  ProbeInstanceRules instanceRules(guard);
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr,
                        &guard.engine.value),
        "rpc-guard-open");
  check(FwpmTransactionBegin0(guard.engine.value, 0), "rpc-guard-transaction");
  try {
    if (crashOwner) {
      probe_recovery_register(guard.engine.value);
      const FWP_BYTE_BLOB blob{sizeof(record),
                               reinterpret_cast<BYTE *>(&record)};
      guard.ids =
          filters(guard.engine.value, port, &probe_recovery_provider, &blob);
    } else
      guard.ids = filters(guard.engine.value, port);
    if (instance) {
      const FWP_BYTE_BLOB blob{sizeof(record),
                               reinterpret_cast<BYTE *>(&record)};
      instanceRules.install(port, sourcePort,
                            crashOwner ? &probe_recovery_provider : nullptr,
                            crashOwner ? &blob : nullptr);
    }
    check(FwpmTransactionCommit0(guard.engine.value), "rpc-guard-commit");
  } catch (...) {
    FwpmTransactionAbort0(guard.engine.value);
    throw;
  }
  ProbeContainment containment(guard.safeToRemove, cacheDirectory != nullptr);
  if (crashOwner) {
    containment.job.close();
    containment.job.value = recoveryJob.value;
    recoveryJob.value = nullptr;
  }
  ProbeDesktop desktop;
  SECURITY_ATTRIBUTES inherit{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  ProbeHandle unused(CreateEventW(&inherit, TRUE, FALSE, nullptr));
  if (!unused.value)
    throw Failure{"rpc-event", GetLastError()};
  ProbeChild worker;
  ProbeLogs logs;
  reserved.close();
  guard.safeToRemove = false;
  probe_launch(
      worker,
      std::wstring(cuda
#ifdef MODELLOOM_VULKAN_HOST
                       ? L"--host 127.0.0.1 --device Vulkan0 --threads 1 --port "
#else
                       ? L"--host 127.0.0.1 --device CUDA0 --threads 1 --port "
#endif
                       : L"--host 127.0.0.1 --device CPU --threads 1 --port ") +
          std::to_wstring(port),
      {unused.value, logs.write.value}, containment.job.value, true, true,
      desktop.name, true, cuda, logs.write.value, cacheRoot.value);
  logs.write.close();
  if (!probe_restricted(worker.process.value))
    throw Failure{"rpc-not-restricted", ERROR_ACCESS_DENIED};
  const auto deadline = GetTickCount64() + 10000;
  while (!probe_rpc_listener(port, worker.pid)) {
    probe_drain_logs(logs.read.value);
    if (WaitForSingleObject(worker.process.value, 0) == WAIT_OBJECT_0) {
      DWORD code = 0;
      GetExitCodeProcess(worker.process.value, &code);
      throw Failure{"rpc-early-exit", code};
    }
    if (GetTickCount64() >= deadline)
      throw Failure{"rpc-ready-timeout", ERROR_TIMEOUT};
    Sleep(20);
  }
  if (!instance)
    client.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  DWORD timeout = 3000;
  if (client.value == INVALID_SOCKET ||
      setsockopt(client.value, SOL_SOCKET, SO_RCVTIMEO,
                 reinterpret_cast<const char *>(&timeout), sizeof(timeout)) ||
      setsockopt(client.value, SOL_SOCKET, SO_SNDTIMEO,
                 reinterpret_cast<const char *>(&timeout), sizeof(timeout)) ||
      connect(client.value, reinterpret_cast<sockaddr *>(&address),
              sizeof(address)))
    throw Failure{"rpc-connect", static_cast<DWORD>(WSAGetLastError())};
  // Pinned upstream 4f31296: HELLO=14, 24-byte zero caps selects TCP;
  // response is version/padding + caps. DEVICE_COUNT=15 returns uint32.
  const bool liveDenied =
      !probe_recover_rules(guard, worker.process.value, worker.process.value,
                           containment.job.value, port);
  if (!liveDenied)
    throw Failure{"rpc-live-recovery-not-denied", ERROR_INVALID_STATE};
  if (relay) {
    pipe.report(
        std::string("{\"phase\":\"relay-ready\",\"workerRestricted\":true,") +
        (cacheUnavailable ? "\"cacheError\":\"CACHE_LOCATION_UNAVAILABLE\","
                          : "") +
        "\"port\":" + std::to_string(port) + "}");
    if (pipe.framed)
      probe_session_relay(pipe, client.value, logs.read.value);
    else
      probe_relay(pipe.value, client.value, logs.read.value);
  } else {
    BYTE caps[24]{}, hello[28]{};
    probe_rpc_command(client.value, 14, caps, sizeof(caps), hello,
                      sizeof(hello));
    if (hello[0] != 7 || hello[1] != 0 || hello[2] != 0)
      throw Failure{"rpc-version", ERROR_REVISION_MISMATCH};
    uint32_t count = 0;
    probe_rpc_command(client.value, 15, nullptr, 0, &count, sizeof(count));
    if (count != 1)
      throw Failure{"rpc-device-count", ERROR_INVALID_DATA};
    pipe.report("{\"phase\":\"worker-ready\",\"scenario\":\"stock-rpc\","
                "\"workerRestricted\":true,\"ownConnectionAllowed\":true,"
                "\"rpcVersion\":\"7.0.0\",\"deviceCount\":1,\"port\":" +
                std::to_string(port) +
                ",\"sourcePort\":" + std::to_string(sourcePort) + "}");
    if (wait_for_stop(pipe.value) == 'C' && crashOwner) {
      if (!TerminateProcess(GetCurrentProcess(), 12))
        throw Failure{"rpc-owner-crash", GetLastError()};
      Sleep(INFINITE);
    }
  }
  client.close();
  check(TerminateJobObject(containment.job.value, 23) ? ERROR_SUCCESS
                                                      : GetLastError(),
        "rpc-stop");
  probe_wait(worker.process.value, "rpc-worker-exit");
  const auto stoppedDeadline = GetTickCount64() + 5000;
  for (;;) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
    if (!QueryInformationJobObject(containment.job.value,
                                   JobObjectBasicAccountingInformation,
                                   &accounting, sizeof(accounting), nullptr))
      throw Failure{"rpc-job-query", GetLastError()};
    if (!accounting.ActiveProcesses)
      break;
    if (GetTickCount64() >= stoppedDeadline)
      throw Failure{"rpc-job-exit", ERROR_TIMEOUT};
    Sleep(10);
  }
  if (!probe_filters_exist(guard.engine.value, guard.ids) || !liveDenied ||
      probe_recover_rules(guard, worker.process.value, worker.process.value,
                          containment.job.value, static_cast<UINT16>(port ^ 1)))
    throw Failure{"rpc-guard-order", ERROR_INVALID_STATE};
  instanceRules.remove();
  check(FwpmEngineClose0(guard.engine.value), "rpc-creation-session-close");
  guard.engine.value = nullptr;
  if (!probe_recover_rules(guard, worker.process.value, worker.process.value,
                           containment.job.value, port, true))
    throw Failure{"rpc-recovery", ERROR_INVALID_STATE};
  guard.ids.clear();
  if (relay)
    return 0;
  pipe.report("{\"phase\":\"worker-stopped\",\"workerExited\":true,"
              "\"guardRetainedUntilExit\":true,\"filtersRemoved\":true,"
              "\"freshSessionRecovery\":true,"
              "\"liveRecoveryDenied\":true,\"mismatchedRecoveryDenied\":true}");
  return 0;
}
