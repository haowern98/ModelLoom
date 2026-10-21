#define WIN32_LEAN_AND_MEAN
#include <node_api.h>
#include <windows.h>
#include <winsock2.h>

#include <dpapi.h>
#include <iphlpapi.h>
#include <memory>
#include <new>

namespace {
struct ProtectedBlob {
  DATA_BLOB value{};
  ~ProtectedBlob() {
    if (value.pbData) {
      SecureZeroMemory(value.pbData, value.cbData);
      LocalFree(value.pbData);
    }
  }
};
napi_value credential_failure(napi_env env) {
  napi_throw_error(env, nullptr, "PEER_IDENTITY_UNAVAILABLE");
  return nullptr;
}
bool argument(napi_env env, napi_callback_info info, napi_value &value) {
  size_t count = 2;
  napi_value args[2]{};
  if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 1)
    return false;
  value = args[0];
  return true;
}
// Fixed peer-identity DPAPI domain; deliberately separate from API-key access.
napi_value unprotect_peer_identity(napi_env env, napi_callback_info info) {
  napi_value value;
  bool buffer = false;
  void *data = nullptr;
  size_t length = 0;
  if (!argument(env, info, value) ||
      napi_is_buffer(env, value, &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, value, &data, &length) != napi_ok ||
      length < 32 || length > 65536)
    return credential_failure(env);
  DATA_BLOB input{static_cast<DWORD>(length), static_cast<BYTE *>(data)};
  BYTE purpose[] = "ModelLoom.peer-identity.v1";
  // .NET's UTF-8 entropy excludes the C string terminator.
  DATA_BLOB entropy{static_cast<DWORD>(sizeof(purpose) - 1), purpose};
  ProtectedBlob output;
  if (!CryptUnprotectData(&input, nullptr, &entropy, nullptr, nullptr,
                          CRYPTPROTECT_UI_FORBIDDEN, &output.value) ||
      !output.value.pbData || !output.value.cbData ||
      output.value.cbData > 16384 || output.value.pbData[0] != 0x30)
    return credential_failure(env);
  napi_value result;
  if (napi_create_buffer_copy(env, output.value.cbData, output.value.pbData,
                              nullptr, &result) != napi_ok)
    return credential_failure(env);
  return result;
}
napi_value loopback_client_pid(napi_env env, napi_callback_info info) {
  size_t count = 3;
  napi_value args[3]{};
  uint32_t local = 0, remote = 0;
  if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 2 ||
      napi_get_value_uint32(env, args[0], &local) != napi_ok || local < 1024 || local > 65535 ||
      napi_get_value_uint32(env, args[1], &remote) != napi_ok || remote < 1024 || remote > 65535)
    return credential_failure(env);
  DWORD bytes = 0, pid = 0;
  if (GetExtendedTcpTable(nullptr, &bytes, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) != ERROR_INSUFFICIENT_BUFFER ||
      bytes > 1024 * 1024)
    return credential_failure(env);
  const DWORD capacity = bytes;
  std::unique_ptr<BYTE[]> storage(new (std::nothrow) BYTE[capacity]);
  if (!storage || GetExtendedTcpTable(storage.get(), &bytes, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) != ERROR_SUCCESS ||
      bytes > capacity || bytes < sizeof(DWORD))
    return credential_failure(env);
  const auto *table = reinterpret_cast<const MIB_TCPTABLE_OWNER_PID *>(storage.get());
  if (table->dwNumEntries > (bytes - sizeof(DWORD)) / sizeof(MIB_TCPROW_OWNER_PID))
    return credential_failure(env);
  for (DWORD i = 0; i < table->dwNumEntries; ++i) {
    const auto &row = table->table[i];
    if (ntohs(static_cast<u_short>(row.dwLocalPort)) == remote &&
        ntohs(static_cast<u_short>(row.dwRemotePort)) == local &&
        row.dwLocalAddr == htonl(INADDR_LOOPBACK) && row.dwRemoteAddr == htonl(INADDR_LOOPBACK) &&
        row.dwState == MIB_TCP_STATE_ESTAB) {
      if (pid && pid != row.dwOwningPid) return credential_failure(env);
      pid = row.dwOwningPid;
    }
  }
  napi_value result;
  if (napi_create_uint32(env, pid, &result) != napi_ok) return credential_failure(env);
  return result;
}
} // namespace
NAPI_MODULE_INIT() {
  const napi_property_descriptor properties[] = {{
      "unprotectPeerIdentity", nullptr, unprotect_peer_identity, nullptr,
      nullptr, nullptr, napi_default, nullptr}, {
      "loopbackClientPid", nullptr, loopback_client_pid, nullptr,
      nullptr, nullptr, napi_default, nullptr}};
  return napi_define_properties(env, exports, 2, properties) == napi_ok
             ? exports : credential_failure(env);
}
