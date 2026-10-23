// Outer Windows Firewall reachability for the authenticated peer control ports.
// This is not native-worker isolation. mTLS and the existing worker guards
// remain required.
#include <netfw.h>
#include <tlhelp32.h>
#include <wrl/client.h>
#include <ws2tcpip.h>

using Microsoft::WRL::ComPtr;
const wchar_t *sharing_group = L"ModelLoom sharing sessions v1";
const wchar_t *sharing_prefix = L"ModelLoom-Sharing-";
void sharing_check(HRESULT result) {
  if (FAILED(result))
    throw Failure{"sharing-firewall", static_cast<DWORD>(result)};
}
struct SharingBstr {
  BSTR value = nullptr;
  SharingBstr() = default;
  explicit SharingBstr(const std::wstring &text) {
    value = SysAllocStringLen(text.data(), static_cast<UINT>(text.size()));
    if (!value)
      throw Failure{"sharing-memory", ERROR_NOT_ENOUGH_MEMORY};
  }
  ~SharingBstr() { SysFreeString(value); }
  SharingBstr(const SharingBstr &) = delete;
  SharingBstr &operator=(const SharingBstr &) = delete;
};
using SharingGet = HRESULT (STDMETHODCALLTYPE INetFwRule::*)(BSTR *);
using SharingPut = HRESULT (STDMETHODCALLTYPE INetFwRule::*)(BSTR);
std::wstring sharing_get(INetFwRule *rule, SharingGet getter) {
  SharingBstr text;
  sharing_check((rule->*getter)(&text.value));
  return text.value ? std::wstring(text.value, SysStringLen(text.value)) : L"";
}
void sharing_put(INetFwRule *rule, SharingPut setter,
                 const std::wstring &text) {
  SharingBstr value(text);
  sharing_check((rule->*setter)(value.value));
}
uint64_t sharing_created(HANDLE process) {
  FILETIME created{}, ended{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &ended, &kernel, &user))
    throw Failure{"sharing-owner-time", GetLastError()};
  return (static_cast<uint64_t>(created.dwHighDateTime) << 32) |
         created.dwLowDateTime;
}
bool sharing_alive(HANDLE process) {
  const auto result = WaitForSingleObject(process, 0);
  if (result == WAIT_FAILED)
    throw Failure{"sharing-owner-wait", GetLastError()};
  return result == WAIT_TIMEOUT;
}
DWORD sharing_parent(DWORD pid) {
  ProbeHandle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (snapshot.value == INVALID_HANDLE_VALUE)
    throw Failure{"sharing-parent", GetLastError()};
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  for (BOOL more = Process32FirstW(snapshot.value, &entry); more;
       more = Process32NextW(snapshot.value, &entry))
    if (entry.th32ProcessID == pid)
      return entry.th32ParentProcessID;
  throw Failure{"sharing-parent", ERROR_NOT_FOUND};
}
std::wstring sharing_image(HANDLE process) {
  wchar_t image[32768]{};
  DWORD size = 32768;
  if (!QueryFullProcessImageNameW(process, 0, image, &size) || !size)
    throw Failure{"sharing-owner-image", GetLastError()};
  return std::wstring(image, size);
}
IN_ADDR sharing_address(const std::wstring &text) {
  IN_ADDR address{};
  wchar_t canonical[INET_ADDRSTRLEN]{};
  if (text.size() > 15 || InetPtonW(AF_INET, text.c_str(), &address) != 1 ||
      !InetNtopW(AF_INET, &address, canonical, INET_ADDRSTRLEN) ||
      text != canonical)
    throw Failure{"sharing-address", ERROR_INVALID_PARAMETER};
  const auto ip = ntohl(address.S_un.S_addr);
  const auto a = ip >> 24, b = (ip >> 16) & 255;
  if (!(a == 127 || a == 10 || (a == 172 && b >= 16 && b <= 31) ||
        (a == 192 && b == 168) || (a == 100 && b >= 64 && b <= 127)))
    throw Failure{"sharing-address", ERROR_INVALID_PARAMETER};
  return address;
}
struct SharingScope {
  std::wstring address, alias, remote;
  DWORD ip = 0;
};
// The firewall service reads single IPv4 addresses back with a /32 netmask.
// Accept only that equivalent spelling; never normalize a wider subnet to one
// host.
std::wstring sharing_rule_address(const std::wstring &text) {
  auto address = text;
  const auto slash = address.find(L'/');
  if (slash != std::wstring::npos) {
    const auto mask = address.substr(slash);
    if (mask != L"/255.255.255.255" && mask != L"/32")
      throw Failure{"sharing-rule-address", ERROR_INVALID_DATA};
    address.resize(slash);
  }
  sharing_address(address);
  return address;
}
SharingScope sharing_scope(const std::wstring &text) {
  const auto ip = sharing_address(text);
  ULONG size = 0;
  const ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST |
                      GAA_FLAG_SKIP_DNS_SERVER;
  if (GetAdaptersAddresses(AF_INET, flags, nullptr, nullptr, &size) !=
          ERROR_BUFFER_OVERFLOW ||
      size > 1024 * 1024)
    throw Failure{"sharing-interface", ERROR_INVALID_DATA};
  std::vector<BYTE> storage(size);
  auto *first = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data());
  check(GetAdaptersAddresses(AF_INET, flags, nullptr, first, &size),
        "sharing-interface");
  SharingScope scope{text, L"", L"LocalSubnet", ip.S_un.S_addr};
  for (auto *adapter = first; adapter; adapter = adapter->Next) {
    if (adapter->OperStatus != IfOperStatusUp || !adapter->FriendlyName)
      continue;
    for (auto *entry = adapter->FirstUnicastAddress; entry;
         entry = entry->Next) {
      if (!entry->Address.lpSockaddr ||
          entry->Address.lpSockaddr->sa_family != AF_INET ||
          reinterpret_cast<sockaddr_in *>(entry->Address.lpSockaddr)
                  ->sin_addr.S_un.S_addr != scope.ip)
        continue;
      if (!scope.alias.empty())
        throw Failure{"sharing-interface", ERROR_DUP_NAME};
      scope.alias = adapter->FriendlyName;
    }
  }
  if (scope.alias.empty())
    throw Failure{"sharing-interface", ERROR_NOT_FOUND};
  const auto value = ntohl(scope.ip);
  if ((value >> 22) == (0x64400000u >> 22)) {
    if (_wcsicmp(scope.alias.c_str(), L"Tailscale") != 0)
      throw Failure{"sharing-interface", ERROR_ACCESS_DENIED};
    scope.remote = L"100.64.0.0/255.192.0.0";
  }
  return scope;
}
void sharing_listeners(DWORD owner, const SharingScope &scope) {
  DWORD size = 0;
  if (GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET,
                          TCP_TABLE_OWNER_PID_LISTENER,
                          0) != ERROR_INSUFFICIENT_BUFFER ||
      size > 4 * 1024 * 1024)
    throw Failure{"sharing-listeners", ERROR_INVALID_DATA};
  std::vector<BYTE> storage(size);
  check(GetExtendedTcpTable(storage.data(), &size, FALSE, AF_INET,
                            TCP_TABLE_OWNER_PID_LISTENER, 0),
        "sharing-listeners");
  const auto *table =
      reinterpret_cast<MIB_TCPTABLE_OWNER_PID *>(storage.data());
  unsigned found = 0;
  for (DWORD i = 0; i < table->dwNumEntries; ++i) {
    const auto &row = table->table[i];
    const auto port = ntohs(static_cast<u_short>(row.dwLocalPort));
    if (row.dwLocalAddr != scope.ip || (port != 49301 && port != 49302))
      continue;
    if (row.dwOwningPid != owner || (found & (port == 49301 ? 1u : 2u)))
      throw Failure{"sharing-listeners", ERROR_ACCESS_DENIED};
    found |= port == 49301 ? 1u : 2u;
  }
  if (found != 3)
    throw Failure{"sharing-listeners", ERROR_NOT_FOUND};
}
void sharing_policy(INetFwPolicy2 *policy) {
  NET_FW_MODIFY_STATE state{};
  sharing_check(policy->get_LocalPolicyModifyState(&state));
  if (state != NET_FW_MODIFY_STATE_OK)
    throw Failure{"sharing-policy", ERROR_ACCESS_DISABLED_BY_POLICY};
  long profiles = 0;
  sharing_check(policy->get_CurrentProfileTypes(&profiles));
  for (const auto profile : {NET_FW_PROFILE2_DOMAIN, NET_FW_PROFILE2_PRIVATE,
                             NET_FW_PROFILE2_PUBLIC}) {
    if (!(profiles & profile))
      continue;
    VARIANT_BOOL blocked = VARIANT_FALSE;
    sharing_check(policy->get_BlockAllInboundTraffic(profile, &blocked));
    if (blocked != VARIANT_FALSE)
      throw Failure{"sharing-policy", ERROR_ACCESS_DISABLED_BY_POLICY};
  }
}
void sharing_interfaces(INetFwRule *rule, const std::wstring &alias) {
  VARIANT list{}, entry{};
  VariantInit(&list);
  VariantInit(&entry);
  list.vt = VT_ARRAY | VT_VARIANT;
  list.parray = SafeArrayCreateVector(VT_VARIANT, 0, 1);
  if (!list.parray)
    throw Failure{"sharing-interface-list", ERROR_NOT_ENOUGH_MEMORY};
  entry.vt = VT_BSTR;
  entry.bstrVal = SysAllocString(alias.c_str());
  LONG index = 0;
  const auto inserted = entry.bstrVal
                            ? SafeArrayPutElement(list.parray, &index, &entry)
                            : E_OUTOFMEMORY;
  VariantClear(&entry);
  const auto result =
      SUCCEEDED(inserted) ? rule->put_Interfaces(list) : inserted;
  VariantClear(&list);
  sharing_check(result);
}
std::wstring sharing_interface(INetFwRule *rule) {
  VARIANT list{}, entry{};
  VariantInit(&list);
  VariantInit(&entry);
  sharing_check(rule->get_Interfaces(&list));
  LONG lower = 0, upper = -1;
  std::wstring result;
  if (list.vt == (VT_ARRAY | VT_VARIANT) && list.parray &&
      SafeArrayGetDim(list.parray) == 1 &&
      SUCCEEDED(SafeArrayGetLBound(list.parray, 1, &lower)) &&
      SUCCEEDED(SafeArrayGetUBound(list.parray, 1, &upper)) && lower == upper &&
      SUCCEEDED(SafeArrayGetElement(list.parray, &lower, &entry)) &&
      entry.vt == VT_BSTR && entry.bstrVal)
    result.assign(entry.bstrVal, SysStringLen(entry.bstrVal));
  VariantClear(&entry);
  VariantClear(&list);
  return result;
}
bool sharing_shape(INetFwRule *rule) {
  long protocol = 0, profiles = 0;
  NET_FW_RULE_DIRECTION direction{};
  NET_FW_ACTION action{};
  VARIANT_BOOL enabled = VARIANT_FALSE, edge = VARIANT_TRUE;
  sharing_check(rule->get_Protocol(&protocol));
  sharing_check(rule->get_Direction(&direction));
  sharing_check(rule->get_Action(&action));
  sharing_check(rule->get_Profiles(&profiles));
  sharing_check(rule->get_Enabled(&enabled));
  sharing_check(rule->get_EdgeTraversal(&edge));
  const auto remote = sharing_get(rule, &INetFwRule::get_RemoteAddresses);
  const auto local = sharing_get(rule, &INetFwRule::get_LocalAddresses);
  const auto require = [](bool valid, const char *stage) {
    if (!valid)
      throw Failure{stage, ERROR_INVALID_STATE};
  };
  require(
      protocol == NET_FW_IP_PROTOCOL_TCP && direction == NET_FW_RULE_DIR_IN &&
          action == NET_FW_ACTION_ALLOW && profiles == NET_FW_PROFILE2_ALL &&
          enabled == VARIANT_TRUE && edge == VARIANT_FALSE,
      "sharing-rule-flags");
  require(sharing_get(rule, &INetFwRule::get_LocalPorts) == L"49301,49302",
          "sharing-rule-ports");
  require(sharing_get(rule, &INetFwRule::get_RemotePorts) == L"*",
          "sharing-rule-remote-ports");
  require(sharing_get(rule, &INetFwRule::get_InterfaceTypes) == L"All",
          "sharing-rule-interface-types");
  require(sharing_get(rule, &INetFwRule::get_ServiceName).empty(),
          "sharing-rule-service");
  require(!sharing_get(rule, &INetFwRule::get_ApplicationName).empty(),
          "sharing-rule-program");
  require(!sharing_interface(rule).empty(), "sharing-rule-interface");
  require(remote == L"LocalSubnet" || remote == L"100.64.0.0/255.192.0.0" ||
              remote == L"100.64.0.0/10",
          "sharing-rule-remote");
  try {
    sharing_rule_address(local);
  } catch (...) {
    return false;
  }
  return true;
}
struct SharingRecord {
  DWORD owner = 0;
  uint64_t created = 0;
  std::wstring nonce;
};
bool sharing_record(const std::wstring &name, const std::wstring &description,
                    SharingRecord &record) {
  const std::wstring prefix(sharing_prefix), tag(L"ModelLoomSharingV1:");
  if (name.size() != prefix.size() + 32 ||
      name.compare(0, prefix.size(), prefix) || description.size() > 128 ||
      description.compare(0, tag.size(), tag))
    return false;
  const auto identity = name.substr(prefix.size());
  if (!nonce(identity.c_str()))
    return false;
  const auto first = description.find(L':', tag.size());
  const auto second =
      first == std::wstring::npos ? first : description.find(L':', first + 1);
  if (first == std::wstring::npos || second == std::wstring::npos ||
      description.substr(second + 1) != identity)
    return false;
  try {
    const auto pid = description.substr(tag.size(), first - tag.size());
    const auto time = description.substr(first + 1, second - first - 1);
    if (pid.empty() || pid.size() > 10 || time.empty() || time.size() > 20 ||
        pid.find_first_not_of(L"0123456789") != std::wstring::npos ||
        time.find_first_not_of(L"0123456789") != std::wstring::npos)
      return false;
    const auto owner = std::stoull(pid), created = std::stoull(time);
    if (!owner || owner > UINT32_MAX || !created ||
        std::to_wstring(owner) != pid || std::to_wstring(created) != time)
      return false;
    record = {static_cast<DWORD>(owner), created, identity};
    return true;
  } catch (...) {
    return false;
  }
}
bool sharing_dead(const SharingRecord &record) {
  ProbeHandle owner(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                                FALSE, record.owner));
  if (!owner.value) {
    if (GetLastError() == ERROR_INVALID_PARAMETER)
      return true;
    throw Failure{"sharing-recovery-owner", GetLastError()};
  }
  return sharing_created(owner.value) != record.created ||
         !sharing_alive(owner.value);
}
bool sharing_missing(HRESULT result) {
  return result == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
}
void sharing_remove(INetFwRules *rules, const std::wstring &name,
                    const std::wstring &description) {
  SharingBstr key(name);
  ComPtr<INetFwRule> current;
  const auto found = rules->Item(key.value, &current);
  if (sharing_missing(found))
    return;
  sharing_check(found);
  if (sharing_get(current.Get(), &INetFwRule::get_Grouping) != sharing_group ||
      sharing_get(current.Get(), &INetFwRule::get_Description) != description)
    throw Failure{"sharing-cleanup-ownership", ERROR_ACCESS_DENIED};
  sharing_check(rules->Remove(key.value));
  current.Reset();
  if (!sharing_missing(rules->Item(key.value, &current)))
    throw Failure{"sharing-cleanup-unconfirmed", ERROR_INVALID_STATE};
}
void sharing_recover(INetFwRules *rules) {
  ComPtr<IUnknown> unknown;
  ComPtr<IEnumVARIANT> iterator;
  sharing_check(rules->get__NewEnum(&unknown));
  sharing_check(unknown.As(&iterator));
  std::vector<std::pair<std::wstring, std::wstring>> stale;
  for (unsigned count = 0;; ++count) {
    if (count > 16384)
      throw Failure{"sharing-recovery-bound", ERROR_TOO_MANY_NAMES};
    VARIANT value{};
    VariantInit(&value);
    const auto next = iterator->Next(1, &value, nullptr);
    if (next == S_FALSE)
      break;
    sharing_check(next);
    ComPtr<INetFwRule> rule;
    const auto queried =
        value.vt == VT_DISPATCH && value.pdispVal
            ? value.pdispVal->QueryInterface(IID_PPV_ARGS(&rule))
            : E_NOINTERFACE;
    VariantClear(&value);
    sharing_check(queried);
    if (sharing_get(rule.Get(), &INetFwRule::get_Grouping) != sharing_group)
      continue;
    const auto name = sharing_get(rule.Get(), &INetFwRule::get_Name);
    const auto description =
        sharing_get(rule.Get(), &INetFwRule::get_Description);
    SharingRecord record;
    if (!sharing_record(name, description, record) ||
        !sharing_shape(rule.Get()))
      throw Failure{"sharing-recovery-scope", ERROR_INVALID_DATA};
    if (sharing_dead(record))
      stale.push_back({name, description});
  }
  for (const auto &entry : stale)
    sharing_remove(rules, entry.first, entry.second);
}
int sharing_network(Pipe &pipe, DWORD launcherPid, const wchar_t *address,
                    const wchar_t *session) {
  ProbeHandle launcher(OpenProcess(
      PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, launcherPid));
  if (!launcher.value || !sharing_alive(launcher.value))
    throw Failure{"sharing-launcher", ERROR_ACCESS_DENIED};
  wchar_t system[32768]{};
  const auto systemLength = GetSystemDirectoryW(system, 32768);
  if (!systemLength || systemLength >= 32768 ||
      _wcsicmp(
          sharing_image(launcher.value).c_str(),
          (std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe")
              .c_str()))
    throw Failure{"sharing-launcher-image", ERROR_ACCESS_DENIED};
  const auto ownerPid = sharing_parent(launcherPid);
  ProbeHandle owner(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                                FALSE, ownerPid));
  if (!owner.value || !sharing_alive(owner.value) ||
      sharing_created(owner.value) > sharing_created(launcher.value) ||
      sharing_created(launcher.value) > sharing_created(GetCurrentProcess()))
    throw Failure{"sharing-owner", ERROR_ACCESS_DENIED};
  const auto image = sharing_image(owner.value);
  const auto scope = sharing_scope(address);
  sharing_listeners(ownerPid, scope);
  sharing_check(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED));
  struct ComLifetime {
    ~ComLifetime() { CoUninitialize(); }
  } lifetime;
  ComPtr<INetFwPolicy2> policy;
  ComPtr<INetFwRules> rules;
  sharing_check(CoCreateInstance(__uuidof(NetFwPolicy2), nullptr,
                                 CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&policy)));
  sharing_check(policy->get_Rules(&rules));
  sharing_policy(policy.Get());
  sharing_recover(rules.Get());
  const auto name = std::wstring(sharing_prefix) + session;
  const auto description =
      L"ModelLoomSharingV1:" + std::to_wstring(GetCurrentProcessId()) + L":" +
      std::to_wstring(sharing_created(GetCurrentProcess())) + L":" + session;
  bool added = false;
  const auto validate = [&]() {
    if (!sharing_alive(owner.value) || !sharing_alive(launcher.value))
      throw Failure{"sharing-owner-exited", ERROR_PROCESS_ABORTED};
    sharing_listeners(ownerPid, scope);
    const auto currentScope = sharing_scope(address);
    if (currentScope.alias != scope.alias ||
        currentScope.remote != scope.remote)
      throw Failure{"sharing-interface-changed", ERROR_INVALID_STATE};
    sharing_policy(policy.Get());
    SharingBstr key(name);
    ComPtr<INetFwRule> current;
    sharing_check(rules->Item(key.value, &current));
    if (!sharing_shape(current.Get()))
      throw Failure{"sharing-rule-address", ERROR_INVALID_STATE};
    if (sharing_get(current.Get(), &INetFwRule::get_Description) !=
            description ||
        sharing_get(current.Get(), &INetFwRule::get_Grouping) != sharing_group)
      throw Failure{"sharing-readback-owner", ERROR_INVALID_STATE};
    if (sharing_get(current.Get(), &INetFwRule::get_ApplicationName) != image)
      throw Failure{"sharing-readback-program", ERROR_INVALID_STATE};
    if (sharing_rule_address(sharing_get(
            current.Get(), &INetFwRule::get_LocalAddresses)) != scope.address)
      throw Failure{"sharing-readback-address", ERROR_INVALID_STATE};
    if (sharing_get(current.Get(), &INetFwRule::get_RemoteAddresses) !=
        scope.remote)
      throw Failure{"sharing-readback-remote", ERROR_INVALID_STATE};
    if (sharing_interface(current.Get()) != scope.alias)
      throw Failure{"sharing-readback-interface", ERROR_INVALID_STATE};
  };
  try {
    SharingBstr key(name);
    ComPtr<INetFwRule> existing;
    if (!sharing_missing(rules->Item(key.value, &existing)))
      throw Failure{"sharing-rule-exists", ERROR_ALREADY_EXISTS};
    ComPtr<INetFwRule> rule;
    sharing_check(CoCreateInstance(__uuidof(NetFwRule), nullptr,
                                   CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&rule)));
    sharing_put(rule.Get(), &INetFwRule::put_Name, name);
    sharing_put(rule.Get(), &INetFwRule::put_Grouping, sharing_group);
    sharing_put(rule.Get(), &INetFwRule::put_Description, description);
    sharing_put(rule.Get(), &INetFwRule::put_ApplicationName, image);
    sharing_check(rule->put_Protocol(NET_FW_IP_PROTOCOL_TCP));
    sharing_put(rule.Get(), &INetFwRule::put_LocalPorts, L"49301,49302");
    sharing_put(rule.Get(), &INetFwRule::put_RemotePorts, L"*");
    sharing_put(rule.Get(), &INetFwRule::put_LocalAddresses, scope.address);
    sharing_put(rule.Get(), &INetFwRule::put_RemoteAddresses, scope.remote);
    sharing_put(rule.Get(), &INetFwRule::put_InterfaceTypes, L"All");
    sharing_interfaces(rule.Get(), scope.alias);
    sharing_check(rule->put_Direction(NET_FW_RULE_DIR_IN));
    sharing_check(rule->put_Action(NET_FW_ACTION_ALLOW));
    sharing_check(rule->put_Profiles(NET_FW_PROFILE2_ALL));
    sharing_check(rule->put_EdgeTraversal(VARIANT_FALSE));
    sharing_check(rule->put_Enabled(VARIANT_TRUE));
    sharing_check(rules->Add(rule.Get()));
    added = true;
    validate();
    pipe.report("{\"phase\":\"network-ready\"}");
    auto nextValidation = GetTickCount64() + 1000;
    for (;;) {
      DWORD available = 0;
      if (!PeekNamedPipe(pipe.value, nullptr, 0, nullptr, &available,
                         nullptr) ||
          !sharing_alive(owner.value) || !sharing_alive(launcher.value))
        break;
      if (available)
        throw Failure{"sharing-unexpected-control", ERROR_INVALID_DATA};
      if (GetTickCount64() >= nextValidation) {
        validate();
        nextValidation = GetTickCount64() + 1000;
      }
      Sleep(50);
    }
    sharing_remove(rules.Get(), name, description);
    return 0;
  } catch (...) {
    if (added)
      sharing_remove(rules.Get(), name, description);
    throw;
  }
}
