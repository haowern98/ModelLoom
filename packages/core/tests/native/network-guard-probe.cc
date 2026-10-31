// Shared guard implementation; the closed product entry rejects diagnostic
// modes.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <windows.h>
#include <winsock2.h>

// WFP declarations require the Windows definitions above.
#include <bcrypt.h>
#include <fwpmu.h>
#include <iphlpapi.h>
#include <sddl.h>

namespace {
struct Failure {
  const char *stage;
  DWORD code;
};
void check(DWORD result, const char *stage) {
  if (result != ERROR_SUCCESS)
    throw Failure{stage, result};
}
#include "network-pipe-io.h"
struct Socket {
  SOCKET value = INVALID_SOCKET;
  ~Socket() { close(); }
  void close() {
    if (value != INVALID_SOCKET)
      closesocket(value);
    value = INVALID_SOCKET;
  }
};
struct Engine {
  HANDLE value = nullptr;
  ~Engine() {
    if (value)
      FwpmEngineClose0(value);
  }
};
struct Pipe {
  HANDLE value = INVALID_HANDLE_VALUE;
  bool framed = false;
  bool closeReceived = false;
  bool ownerGone = false;
  bool overlapped = false;
  bool relaying = false;
  HANDLE ownerProcess = nullptr;
  ~Pipe() {
    if (value != INVALID_HANDLE_VALUE)
      CloseHandle(value);
    if (ownerProcess)
      CloseHandle(ownerProcess);
  }
  bool transfer(void *bytes, DWORD length, DWORD &count, bool writing,
                DWORD timeout = INFINITE) {
    if (!overlapped)
      return (writing ? WriteFile(value, bytes, length, &count, nullptr)
                      : ReadFile(value, bytes, length, &count, nullptr)) != 0;
    ProbePipeIo io;
    io.start(value, bytes, length, writing);
    const bool ok = io.wait(timeout);
    count = io.count;
    if (!ok)
      SetLastError(io.error);
    return ok;
  }
  void report(const std::string &text) {
    if (text.size() > 4095)
      throw Failure{"report-size", ERROR_INVALID_DATA};
    std::string line;
    if (framed) {
      const uint32_t size = static_cast<uint32_t>(text.size() + 1);
      line.assign(reinterpret_cast<const char *>(&size), sizeof(size));
      line.push_back(1);
      line += text;
    } else
      line = text + "\n";
    DWORD written = 0;
    if (!transfer(line.data(), static_cast<DWORD>(line.size()), written, true) ||
        written != line.size())
      throw Failure{"report-write", GetLastError()};
  }
};
bool elevated() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    return false;
  TOKEN_ELEVATION elevation{};
  DWORD bytes = 0;
  const bool result = GetTokenInformation(token, TokenElevation, &elevation,
                                          sizeof(elevation), &bytes) &&
                      elevation.TokenIsElevated;
  CloseHandle(token);
  return result;
}
bool nonce(const wchar_t *text) {
  const std::wstring value(text);
  if (value.size() != 32)
    return false;
  for (const wchar_t c : value)
    if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f')))
      return false;
  return true;
}
DWORD parent_pid(const wchar_t *text) {
  uint64_t value = 0;
  const std::wstring input(text);
  if (input.empty() || input.size() > 10)
    throw Failure{"parent-pid", ERROR_INVALID_PARAMETER};
  for (const wchar_t c : input) {
    if (c < L'0' || c > L'9')
      throw Failure{"parent-pid", ERROR_INVALID_PARAMETER};
    value = value * 10 + static_cast<uint64_t>(c - L'0');
  }
  if (!value || value > UINT32_MAX)
    throw Failure{"parent-pid", ERROR_INVALID_PARAMETER};
  return static_cast<DWORD>(value);
}
std::vector<UINT64> filters(HANDLE engine, UINT16 port,
                            const GUID *provider = nullptr,
                            const FWP_BYTE_BLOB *record = nullptr) {
  wchar_t image[32768];
  const DWORD length = GetModuleFileNameW(nullptr, image, 32768);
  if (!length || length >= 32768)
    throw Failure{"image", GetLastError()};
  FWP_BYTE_BLOB *app = nullptr;
  check(FwpmGetAppIdFromFileName0(image, &app), "application-id");
  std::vector<UINT64> ids;
  try {
    for (int family = 0; family < 2; ++family) {
      FWPM_FILTER_CONDITION0 conditions[4]{};
      conditions[0].fieldKey = FWPM_CONDITION_IP_PROTOCOL;
      conditions[0].matchType = FWP_MATCH_EQUAL;
      conditions[0].conditionValue.type = FWP_UINT8;
      conditions[0].conditionValue.uint8 = IPPROTO_TCP;
      conditions[1].fieldKey = FWPM_CONDITION_IP_REMOTE_PORT;
      conditions[1].matchType = FWP_MATCH_EQUAL;
      conditions[1].conditionValue.type = FWP_UINT16;
      conditions[1].conditionValue.uint16 = port;
      FWP_V4_ADDR_AND_MASK ipv4{0x7f000001, 0xffffffff};
      FWP_V6_ADDR_AND_MASK ipv6{};
      ipv6.addr[10] = 0xff;
      ipv6.addr[11] = 0xff;
      ipv6.addr[12] = 127;
      ipv6.addr[15] = 1;
      ipv6.prefixLength = 128;
      conditions[2].fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
      conditions[2].matchType = FWP_MATCH_EQUAL;
      conditions[2].conditionValue.type =
          family ? FWP_V6_ADDR_MASK : FWP_V4_ADDR_MASK;
      if (family)
        conditions[2].conditionValue.v6AddrMask = &ipv6;
      else
        conditions[2].conditionValue.v4AddrMask = &ipv4;
      conditions[3].fieldKey = FWPM_CONDITION_ALE_APP_ID;
      conditions[3].matchType = FWP_MATCH_NOT_EQUAL;
      conditions[3].conditionValue.type = FWP_BYTE_BLOB_TYPE;
      conditions[3].conditionValue.byteBlob = app;
      FWPM_FILTER0 filter{};
      filter.providerKey = const_cast<GUID *>(provider);
      if (record)
        filter.providerData = *record;
      filter.displayData.name =
          const_cast<wchar_t *>(L"ModelLoom diagnostic TCP guard");
      filter.layerKey = family ? FWPM_LAYER_ALE_AUTH_CONNECT_V6
                               : FWPM_LAYER_ALE_AUTH_CONNECT_V4;
      filter.subLayerKey = FWPM_SUBLAYER_UNIVERSAL;
      filter.action.type = FWP_ACTION_BLOCK;
      filter.weight.type = FWP_UINT8;
      filter.weight.uint8 = 15;
      filter.numFilterConditions = 4;
      filter.filterCondition = conditions;
      UINT64 id = 0;
      check(FwpmFilterAdd0(engine, &filter, nullptr, &id), "add-filter");
      ids.push_back(id);
    }
  } catch (...) {
    FwpmFreeMemory0(reinterpret_cast<void **>(&app));
    throw;
  }
  FwpmFreeMemory0(reinterpret_cast<void **>(&app));
  return ids;
}
bool removed(const std::vector<UINT64> &ids) {
  Engine inspection;
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr,
                        &inspection.value),
        "cleanup-open");
  for (const auto id : ids) {
    FWPM_FILTER0 *filter = nullptr;
    const DWORD code = FwpmFilterGetById0(inspection.value, id, &filter);
    if (filter)
      FwpmFreeMemory0(reinterpret_cast<void **>(&filter));
    if (code != static_cast<DWORD>(FWP_E_FILTER_NOT_FOUND))
      return false;
  }
  return true;
}
char wait_for_stop(HANDLE pipe) {
  const ULONGLONG deadline = GetTickCount64() + 30000;
  while (GetTickCount64() < deadline) {
    DWORD bytes = 0;
    if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &bytes, nullptr))
      return 'S';
    if (bytes) {
      char command = 0;
      DWORD read = 0;
      if (!ReadFile(pipe, &command, 1, &read, nullptr) || read != 1 ||
          (command != 'S' && command != 'C'))
        throw Failure{"stop-command", ERROR_INVALID_DATA};
      return command;
    }
    Sleep(20);
  }
  throw Failure{"stop-timeout", ERROR_TIMEOUT};
}
int run(Pipe &pipe) {
  WSADATA data{};
  check(static_cast<DWORD>(WSAStartup(MAKEWORD(2, 2), &data)), "winsock-start");
  struct Winsock {
    ~Winsock() { WSACleanup(); }
  } winsock;
  Socket listener;
  listener.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (listener.value == INVALID_SOCKET)
    throw Failure{"socket", static_cast<DWORD>(WSAGetLastError())};
  BOOL exclusive = TRUE;
  if (setsockopt(listener.value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                 reinterpret_cast<const char *>(&exclusive), sizeof(exclusive)))
    throw Failure{"exclusive", static_cast<DWORD>(WSAGetLastError())};
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(listener.value, reinterpret_cast<sockaddr *>(&address),
           sizeof(address)))
    throw Failure{"bind", static_cast<DWORD>(WSAGetLastError())};
  int size = sizeof(address);
  if (getsockname(listener.value, reinterpret_cast<sockaddr *>(&address),
                  &size))
    throw Failure{"port", static_cast<DWORD>(WSAGetLastError())};
  Engine engine;
  FWPM_SESSION0 session{};
  session.flags = FWPM_SESSION_FLAG_DYNAMIC;
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, &session,
                        &engine.value),
        "filter-open");
  const auto ids = filters(engine.value, ntohs(address.sin_port));
  if (listen(listener.value, 1))
    throw Failure{"listen", static_cast<DWORD>(WSAGetLastError())};
  Socket own;
  own.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (own.value == INVALID_SOCKET)
    throw Failure{"own-socket", static_cast<DWORD>(WSAGetLastError())};
  u_long nonblocking = 1;
  if (ioctlsocket(own.value, FIONBIO, &nonblocking))
    throw Failure{"own-mode", static_cast<DWORD>(WSAGetLastError())};
  if (connect(own.value, reinterpret_cast<sockaddr *>(&address),
              sizeof(address))) {
    if (WSAGetLastError() != WSAEWOULDBLOCK)
      throw Failure{"own-connect", static_cast<DWORD>(WSAGetLastError())};
    fd_set writable, failed;
    FD_ZERO(&writable);
    FD_ZERO(&failed);
    FD_SET(own.value, &writable);
    FD_SET(own.value, &failed);
    timeval timeout{5, 0};
    if (select(0, nullptr, &writable, &failed, &timeout) <= 0 ||
        FD_ISSET(own.value, &failed))
      throw Failure{"own-connect-timeout", ERROR_TIMEOUT};
    int error = 0;
    int error_size = sizeof(error);
    if (getsockopt(own.value, SOL_SOCKET, SO_ERROR,
                   reinterpret_cast<char *>(&error), &error_size) ||
        error)
      throw Failure{"own-connect-error",
                    static_cast<DWORD>(error ? error : WSAGetLastError())};
  }
  Socket accepted;
  accepted.value = accept(listener.value, nullptr, nullptr);
  if (accepted.value == INVALID_SOCKET)
    throw Failure{"own-accept", static_cast<DWORD>(WSAGetLastError())};
  linger reset{1, 0};
  if (setsockopt(own.value, SOL_SOCKET, SO_LINGER,
                 reinterpret_cast<const char *>(&reset), sizeof(reset)))
    throw Failure{"own-close-mode", static_cast<DWORD>(WSAGetLastError())};
  own.close();
  accepted.close();
  pipe.report("{\"phase\":\"ready\",\"ownConnectionAllowed\":true,\"port\":" +
              std::to_string(ntohs(address.sin_port)) + "}");
  if (wait_for_stop(pipe.value) == 'C') {
    if (!TerminateProcess(GetCurrentProcess(), 12))
      throw Failure{"terminate-self", GetLastError()};
    Sleep(INFINITE);
  }
  listener.close();
  check(FwpmEngineClose0(engine.value), "filter-close");
  engine.value = nullptr;
  if (!removed(ids))
    throw Failure{"cleanup-unconfirmed", ERROR_INVALID_STATE};
  pipe.report("{\"phase\":\"stopped\",\"ownedFiltersRemoved\":true}");
  return 0;
}
} // namespace

#include "network-worker-probe.h"

// Recovery reads privileged WFP metadata without surviving owner handles.
#include "network-recovery-probe.h"

// Extra guards require an exclusively held source and elevated helper role.
#include "network-instance-probe.h"

// Opaque data mode is used only by the bounded authenticated RPC diagnostic.
#include "network-relay-probe.h"

// Private owner framing keeps one elevation while each worker remains separate.
#include "network-session-relay.h"

// Stock diagnostic reuses the worker ownership/recovery primitives above.
#include "network-rpc-probe.h"
#include "network-session-probe.h"
#include "../../native/sharing-network.h"
#ifndef MODELLOOM_PEER_HOST
#include "network-session-fixture.h"
#include "network-readiness-fixture.h"
#include "sharing-network-fixture.h"
#endif

int wmain(int argc, wchar_t **argv) {
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX |
               SEM_NOOPENFILEERRORBOX);
  const bool sharingRequest = argc == 5 && std::wstring(argv[3]) == L"--sharing-network";
#ifdef MODELLOOM_PEER_HOST
  const bool cudaRequest = argc == 5 &&
                           (std::wstring(argv[3]) == L"--rpc-relay-cuda" ||
                            std::wstring(argv[3]) == L"--rpc-session-cuda") &&
                           probe_valid_gpu_uuid(argv[4]);
  const bool recoveryRequest =
      argc == 4 && std::wstring(argv[3]) == L"--recover-crash";
  if (!cudaRequest && !recoveryRequest && !sharingRequest)
    return ERROR_INVALID_PARAMETER;
#endif
  try {
#ifndef MODELLOOM_PEER_HOST
    if (argc == 2 && std::wstring(argv[1]) == L"--sharing-policy-fixture")
      return sharing_policy_fixture();
    if (argc == 2 && std::wstring(argv[1]) == L"--session-frame-fixture")
      return probe_session_frame_fixture();
    if (argc == 2 && std::wstring(argv[1]) == L"--readiness-fixture")
      return probe_readiness_fixture();
    if (argc == 2 && std::wstring(argv[1]) == L"--readiness-lifecycle-fixture") {
      for (unsigned scenario = 1; scenario <= 6; ++scenario) {
        const int result = probe_readiness_fixture(scenario);
        if (result) return result;
      }
      return 0;
    }
#endif
    if (argc == 3 && std::wstring(argv[1]) == L"--clone-client") {
      const DWORD port = parent_pid(argv[2]);
      if (port < 1024 || port > 65535 || elevated())
        return 2;
      WSADATA data{};
      if (WSAStartup(MAKEWORD(2, 2), &data))
        return 3;
      Socket client;
      client.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
      u_long nonblocking = 1;
      if (client.value == INVALID_SOCKET ||
          ioctlsocket(client.value, FIONBIO, &nonblocking))
        return 4;
      sockaddr_in address{};
      address.sin_family = AF_INET;
      address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
      address.sin_port = htons(static_cast<UINT16>(port));
      const auto result =
          connect(client.value, reinterpret_cast<sockaddr *>(&address),
                  sizeof(address));
      if (!result)
        return 1;
      int error = WSAGetLastError();
      if (error == WSAEWOULDBLOCK) {
        fd_set writable, failed;
        FD_ZERO(&writable);
        FD_ZERO(&failed);
        FD_SET(client.value, &writable);
        FD_SET(client.value, &failed);
        timeval timeout{3, 0};
        if (select(0, nullptr, &writable, &failed, &timeout) <= 0)
          return 5;
        int size = sizeof(error);
        if (getsockopt(client.value, SOL_SOCKET, SO_ERROR,
                       reinterpret_cast<char *>(&error), &size))
          return 6;
      }
      return error == WSAEACCES ? 0 : 1;
    }
    if (argc > 1 && std::wstring(argv[1]) == L"--fixture")
      return probe_fixture(argc, argv);
    if (argc > 1 && std::wstring(argv[1]) == L"--owner")
      return probe_owner(argc, argv);
    if (argc == 3 && std::wstring(argv[1]) == L"--sentinel")
      return WaitForSingleObject(probe_parse_handle(argv[2]), 30000) ==
                     WAIT_OBJECT_0
                 ? 0
                 : 3;
  } catch (const Failure &failure) {
    return static_cast<int>(failure.code);
  } catch (...) {
    return 2;
  }
  if (!elevated()) {
    std::puts("{\"phase\":\"requires-elevation\",\"filtersInstalled\":false}");
    return ERROR_ELEVATION_REQUIRED;
  }
  Pipe pipe;
  const bool rawRelay =
#ifdef MODELLOOM_PEER_HOST
      cudaRequest;
#else
      argc == 4 && (std::wstring(argv[3]) == L"--rpc-relay-cpu" ||
                    std::wstring(argv[3]) == L"--rpc-relay-cuda");
#endif
  try {
    const bool separate =
        argc == 4 && std::wstring(argv[3]) == L"--separate-worker";
    const bool rpc = argc == 4 && std::wstring(argv[3]) == L"--rpc-smoke";
    const bool crash = argc == 4 && std::wstring(argv[3]) == L"--crash-owner";
    const bool recover =
        argc == 4 && std::wstring(argv[3]) == L"--recover-crash";
    const bool instance =
        argc == 4 && std::wstring(argv[3]) == L"--instance-smoke";
    const bool session =
#ifdef MODELLOOM_PEER_HOST
        cudaRequest && std::wstring(argv[3]) == L"--rpc-session-cuda";
#else
        argc == 4 && (std::wstring(argv[3]) == L"--rpc-session-cpu" ||
                      std::wstring(argv[3]) == L"--rpc-session-cuda");
#endif
    if ((!sharingRequest && !separate && !rpc && !crash && !recover && !instance && !rawRelay &&
         !session && argc != 3) ||
        !nonce(argv[1]))
      throw Failure{"arguments", ERROR_INVALID_PARAMETER};
    const DWORD parent = parent_pid(argv[2]);
    const std::wstring name =
        std::wstring(L"\\\\.\\pipe\\ModelLoom-guard-probe-") + argv[1];
    pipe.overlapped = session;
    pipe.value = CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0,
                             nullptr, OPEN_EXISTING,
                             session ? FILE_FLAG_OVERLAPPED : 0, nullptr);
    if (pipe.value == INVALID_HANDLE_VALUE)
      throw Failure{"control-pipe", GetLastError()};
    ULONG server = 0;
    if (!GetNamedPipeServerProcessId(pipe.value, &server) || server != parent)
      throw Failure{"control-owner", ERROR_ACCESS_DENIED};
    if (session) {
      pipe.ownerProcess = OpenProcess(SYNCHRONIZE, FALSE, parent);
      if (!pipe.ownerProcess)
        throw Failure{"control-owner-handle", GetLastError()};
    }
    if (sharingRequest)
      return sharing_network(pipe, parent, argv[4], argv[1]);
    if (separate)
      return probe_workers(pipe);
    if (rpc)
      return probe_rpc(pipe);
    if (crash)
      return probe_rpc(pipe, true, true);
    if (recover)
      return probe_recover_crash(pipe);
    if (instance)
      return probe_rpc(pipe, false, true);
    if (session) {
#ifdef MODELLOOM_PEER_HOST
      if (!SetEnvironmentVariableW(L"MODELLOOM_PROBE_GPU_UUID", argv[4]))
        throw Failure{"worker-gpu-uuid", GetLastError()};
#endif
      return probe_session(pipe,
                           std::wstring(argv[3]) == L"--rpc-session-cuda");
    }
    if (rawRelay)
#ifdef MODELLOOM_PEER_HOST
    {
      // Shell elevation does not retain the ordinary owner's custom
      // environment. Accept only the validated physical UUID after binding the
      // control owner.
      if (!SetEnvironmentVariableW(L"MODELLOOM_PROBE_GPU_UUID", argv[4]))
        throw Failure{"worker-gpu-uuid", GetLastError()};
      probe_recover_crash(pipe, false);
      return probe_rpc(pipe, true, true, true, true);
    }
#else
      return probe_rpc(pipe, true, true, true,
                       std::wstring(argv[3]) == L"--rpc-relay-cuda");
#endif
    run(pipe);
    return run(pipe);
  } catch (const Failure &failure) {
    std::string nativeHex;
    const char digits[] = "0123456789abcdef";
    for (const unsigned char c : probe_runtime_tail) {
      nativeHex.push_back(digits[c >> 4]);
      nativeHex.push_back(digits[c & 15]);
    }
    const std::string report = "{\"phase\":\"error\",\"stage\":\"" +
                               std::string(failure.stage) +
                               "\",\"code\":" + std::to_string(failure.code) +
                               ",\"nativeLogHex\":\"" + nativeHex + "\"}";
    if (rawRelay) {
      // Startup failure is reported on the readiness channel. After a relay
      // starts it may contain only stock protocol bytes, so close it on
      // failure.
      DWORD mode = 0;
      if (!pipe.relaying && pipe.value != INVALID_HANDLE_VALUE &&
          GetNamedPipeHandleStateW(pipe.value, &mode, nullptr, nullptr, nullptr,
                                   nullptr, 0) &&
          !(mode & PIPE_NOWAIT)) {
        try {
          pipe.report(report);
        } catch (...) {
        }
      }
    } else if (pipe.value != INVALID_HANDLE_VALUE) {
      try {
        pipe.report(report);
      } catch (...) {
      }
    } else
      std::puts(report.c_str());
    return 1;
  } catch (...) {
    return 1;
  }
}
