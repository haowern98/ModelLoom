// Static WFP providerData is the privileged recovery journal. No renderer path,
// file, PID supplied by a caller, or surviving controller handle is trusted.
const GUID probe_recovery_provider = {
#ifdef MODELLOOM_PEER_HOST
    0x7ff390e4,
    0xd345,
    0x4b4b,
    {0xad, 0xc6, 0x7f, 0x55, 0x88, 0x72, 0x14, 0x30}};
#else
    0x75f9c722,
    0x3e08,
    0x4473,
    {0x9c, 0xb3, 0xb9, 0x81, 0xc3, 0x77, 0x70, 0x6d}};
#endif
struct ProbeRecoveryRecord {
  uint32_t version = 1;
  DWORD owner = 0;
  FILETIME created{};
  BYTE id[16]{};
  UINT16 port = 0;
  UINT16 source = 0;
};
std::wstring probe_recovery_job(const ProbeRecoveryRecord &record) {
  std::wstring name = L"Global\\ModelLoomGuardProbe-";
  constexpr wchar_t hex[] = L"0123456789abcdef";
  for (const BYTE value : record.id) {
    name += hex[value >> 4];
    name += hex[value & 15];
  }
  return name;
}
void probe_record_owner(ProbeRecoveryRecord &record, UINT16 port) {
  FILETIME exited{}, kernel{}, user{};
  record.owner = GetCurrentProcessId();
  record.port = port;
  if (!GetProcessTimes(GetCurrentProcess(), &record.created, &exited, &kernel,
                       &user))
    throw Failure{"recovery-owner-time", GetLastError()};
  if (BCryptGenRandom(nullptr, record.id, sizeof(record.id),
                      BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
    throw Failure{"recovery-job-identity", ERROR_GEN_FAILURE};
}
HANDLE probe_recovery_create_job(const ProbeRecoveryRecord &record) {
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  // Administrators own this object: the unelevated same-user token must not
  // acquire implicit owner WRITE_DAC rights or retain the kill-on-close job.
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          L"O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)", SDDL_REVISION_1, &descriptor,
          nullptr))
    throw Failure{"recovery-job-security", GetLastError()};
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
  ProbeHandle job(
      CreateJobObjectW(&security, probe_recovery_job(record).c_str()));
  const DWORD error = GetLastError();
  LocalFree(descriptor);
  if (!job.value || error == ERROR_ALREADY_EXISTS)
    throw Failure{"recovery-job-create", error};
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
#ifdef MODELLOOM_PEER_HOST
  limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
  limits.BasicLimitInformation.ActiveProcessLimit = 1;
#endif
  if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits)))
    throw Failure{"recovery-job-limits", GetLastError()};
  HANDLE result = job.value;
  job.value = nullptr;
  return result;
}
void probe_recovery_register(HANDLE engine) {
  FWPM_PROVIDER0 provider{};
  provider.providerKey = probe_recovery_provider;
  provider.displayData.name =
      const_cast<wchar_t *>(L"ModelLoom crash diagnostic");
  const DWORD result = FwpmProviderAdd0(engine, &provider, nullptr);
  if (result != ERROR_SUCCESS &&
      result != static_cast<DWORD>(FWP_E_ALREADY_EXISTS))
    throw Failure{"recovery-provider-add", result};
}
bool probe_recovery_owner_alive(const ProbeRecoveryRecord &record) {
  ProbeHandle process(OpenProcess(
      PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, record.owner));
  if (!process.value) {
    if (GetLastError() == ERROR_INVALID_PARAMETER)
      return false;
    throw Failure{"recovery-owner-open", GetLastError()};
  }
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process.value, &created, &exited, &kernel, &user))
    throw Failure{"recovery-owner-query", GetLastError()};
  // A reused PID is never killed, waited upon or treated as this owner.
  if (CompareFileTime(&created, &record.created))
    return false;
  const auto result = WaitForSingleObject(process.value, 0);
  if (result == WAIT_FAILED)
    throw Failure{"recovery-owner-wait", GetLastError()};
  return result != WAIT_OBJECT_0;
}
bool probe_recovery_job_empty(const ProbeRecoveryRecord &record) {
  ProbeHandle job(OpenJobObjectW(JOB_OBJECT_QUERY, FALSE,
                                 probe_recovery_job(record).c_str()));
  if (!job.value) {
    // A job is destroyed only after its handles close AND members terminate.
    if (GetLastError() == ERROR_FILE_NOT_FOUND)
      return true;
    throw Failure{"recovery-job-open", GetLastError()};
  }
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(job.value, JobObjectBasicAccountingInformation,
                                 &accounting, sizeof(accounting), nullptr))
    throw Failure{"recovery-job-accounting", GetLastError()};
  return !accounting.ActiveProcesses;
}
bool probe_recovery_admin(const FWP_BYTE_BLOB *security) {
  if (!security || !security->data ||
      security->size < SECURITY_DESCRIPTOR_MIN_LENGTH ||
      !IsValidSecurityDescriptor(security->data) ||
      GetSecurityDescriptorLength(security->data) != security->size)
    return false;
  PACL acl = nullptr;
  BOOL present = FALSE, defaulted = FALSE;
  if (!GetSecurityDescriptorDacl(security->data, &present, &acl, &defaulted) ||
      !present || !acl || acl->AceCount != 1)
    return false;
  void *entry = nullptr;
  if (!GetAce(acl, 0, &entry))
    return false;
  const auto *ace = static_cast<const ACCESS_ALLOWED_ACE *>(entry);
  return ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE &&
         !ace->Header.AceFlags && ace->Mask == 1 &&
         IsWellKnownSid(const_cast<DWORD *>(&ace->SidStart),
                        WinBuiltinAdministratorsSid);
}
unsigned probe_recovery_kind(const FWPM_FILTER0 &filter) {
  unsigned kind = 0;
  for (UINT32 i = 0; i < filter.numFilterConditions; ++i) {
    const auto &key = filter.filterCondition[i].fieldKey;
    if (IsEqualGUID(key, FWPM_CONDITION_ALE_APP_ID))
      kind = 1;
    if (IsEqualGUID(key, FWPM_CONDITION_IP_LOCAL_PORT))
      kind = 2;
    if (IsEqualGUID(key, FWPM_CONDITION_ALE_USER_ID))
      kind = 3;
  }
  return kind;
}
bool probe_recovery_filter(const FWPM_FILTER0 &filter,
                           const ProbeRecoveryRecord &record,
                           const FWP_BYTE_BLOB &app) {
  if (!filter.providerKey ||
      !IsEqualGUID(*filter.providerKey, probe_recovery_provider) ||
      filter.providerData.size != sizeof(record) || !filter.providerData.data ||
      std::memcmp(filter.providerData.data, &record, sizeof(record)) ||
      filter.flags || filter.action.type != FWP_ACTION_BLOCK ||
      !IsEqualGUID(filter.subLayerKey, FWPM_SUBLAYER_UNIVERSAL) ||
      filter.numFilterConditions != 4)
    return false;
  const bool ipv4 =
      IsEqualGUID(filter.layerKey, FWPM_LAYER_ALE_AUTH_CONNECT_V4);
  if (!ipv4 && !IsEqualGUID(filter.layerKey, FWPM_LAYER_ALE_AUTH_CONNECT_V6))
    return false;
  unsigned fields = 0;
  for (UINT32 i = 0; i < filter.numFilterConditions; ++i) {
    const auto &condition = filter.filterCondition[i];
    const auto &value = condition.conditionValue;
    unsigned field = 0;
    if (IsEqualGUID(condition.fieldKey, FWPM_CONDITION_IP_PROTOCOL) &&
        condition.matchType == FWP_MATCH_EQUAL && value.type == FWP_UINT8 &&
        value.uint8 == IPPROTO_TCP)
      field = 1;
    else if (IsEqualGUID(condition.fieldKey, FWPM_CONDITION_IP_REMOTE_PORT) &&
             condition.matchType == FWP_MATCH_EQUAL &&
             value.type == FWP_UINT16 && value.uint16 == record.port)
      field = 2;
    else if (IsEqualGUID(condition.fieldKey, FWPM_CONDITION_ALE_APP_ID) &&
             condition.matchType == FWP_MATCH_NOT_EQUAL &&
             value.type == FWP_BYTE_BLOB_TYPE && value.byteBlob &&
             value.byteBlob->size == app.size &&
             !std::memcmp(value.byteBlob->data, app.data, app.size))
      field = 4;
    else if (record.version == 2 &&
             IsEqualGUID(condition.fieldKey, FWPM_CONDITION_IP_LOCAL_PORT) &&
             condition.matchType == FWP_MATCH_NOT_EQUAL &&
             value.type == FWP_UINT16 && value.uint16 == record.source)
      field = 4;
    else if (record.version == 2 &&
             IsEqualGUID(condition.fieldKey, FWPM_CONDITION_ALE_USER_ID) &&
             condition.matchType == FWP_MATCH_NOT_EQUAL &&
             value.type == FWP_SECURITY_DESCRIPTOR_TYPE &&
             probe_recovery_admin(value.sd))
      field = 4;
    else if (IsEqualGUID(condition.fieldKey,
                         FWPM_CONDITION_IP_REMOTE_ADDRESS) &&
             condition.matchType == FWP_MATCH_EQUAL) {
      if (ipv4 && value.type == FWP_V4_ADDR_MASK && value.v4AddrMask &&
          value.v4AddrMask->addr == 0x7f000001 &&
          value.v4AddrMask->mask == 0xffffffff)
        field = 8;
      if (!ipv4 && value.type == FWP_V6_ADDR_MASK && value.v6AddrMask) {
        BYTE mapped[16]{};
        mapped[10] = mapped[11] = 0xff;
        mapped[12] = 127;
        mapped[15] = 1;
        if (value.v6AddrMask->prefixLength == 128 &&
            !std::memcmp(value.v6AddrMask->addr, mapped, sizeof(mapped)))
          field = 8;
      }
    }
    if (!field || (fields & field))
      return false;
    fields |= field;
  }
  return fields == 15;
}
int probe_recover_crash(Pipe &pipe, bool publishReport = true) {
  Engine engine;
  check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr,
                        &engine.value),
        "restart-open");
  FWPM_FILTER_ENUM_TEMPLATE0 query{};
  query.providerKey = const_cast<GUID *>(&probe_recovery_provider);
  query.actionMask = 0xffffffff;
  std::vector<FWPM_FILTER0 *> entries;
  struct Entries {
    FWPM_FILTER0 **layers[2]{};
    ~Entries() {
      for (auto &layer : layers)
        if (layer)
          FwpmFreeMemory0(reinterpret_cast<void **>(&layer));
    }
  } storage;
  for (int layer = 0; layer < 2; ++layer) {
    query.layerKey =
        layer ? FWPM_LAYER_ALE_AUTH_CONNECT_V6 : FWPM_LAYER_ALE_AUTH_CONNECT_V4;
    HANDLE enumeration = nullptr;
    check(FwpmFilterCreateEnumHandle0(engine.value, &query, &enumeration),
          "restart-enumeration");
    UINT32 found = 0;
    const DWORD result = FwpmFilterEnum0(engine.value, enumeration, 129,
                                         &storage.layers[layer], &found);
    FwpmFilterDestroyEnumHandle0(engine.value, enumeration);
    check(result, "restart-read");
    if (found > 128 || entries.size() + found > 128)
      throw Failure{"restart-record-limit", ERROR_BUFFER_OVERFLOW};
    for (UINT32 i = 0; i < found; ++i)
      entries.push_back(storage.layers[layer][i]);
  }
  FWP_BYTE_BLOB *app = nullptr;
  check(FwpmGetAppIdFromFileName0(probe_image().c_str(), &app), "restart-app");
  UINT32 assignments = 0, removedCount = 0, live = 0;
  try {
    std::map<std::wstring, std::vector<FWPM_FILTER0 *>> groups;
    for (size_t i = 0; i < entries.size(); ++i) {
      ProbeRecoveryRecord record{};
      if (entries[i]->providerData.size != sizeof(record) ||
          !entries[i]->providerData.data)
        throw Failure{"restart-record-size", ERROR_INVALID_DATA};
      std::memcpy(&record, entries[i]->providerData.data, sizeof(record));
      if ((record.version != 1 && record.version != 2) || !record.owner ||
          record.port < 1024 ||
          (record.version == 1 ? record.source != 0 : record.source < 1024) ||
          !probe_recovery_filter(*entries[i], record, *app))
        throw Failure{"restart-record-scope", ERROR_INVALID_DATA};
      groups[probe_recovery_job(record)].push_back(entries[i]);
    }
    // Validate complete pairs before performing any deletion.
    for (const auto &group : groups) {
      const auto &pair = group.second;
      ProbeRecoveryRecord record{};
      std::memcpy(&record, pair[0]->providerData.data, sizeof(record));
      if (pair.size() != (record.version == 2 ? 6u : 2u))
        throw Failure{"restart-record-pair", ERROR_INVALID_DATA};
      unsigned seen = 0;
      for (const auto *filter : pair) {
        const auto kind = probe_recovery_kind(*filter);
        if (!kind ||
            std::memcmp(pair[0]->providerData.data, filter->providerData.data,
                        sizeof(ProbeRecoveryRecord)))
          throw Failure{"restart-record-pair", ERROR_INVALID_DATA};
        const unsigned bit =
            1u << ((kind - 1) * 2 + (IsEqualGUID(filter->layerKey,
                                                 FWPM_LAYER_ALE_AUTH_CONNECT_V6)
                                         ? 1
                                         : 0));
        if (seen & bit)
          throw Failure{"restart-duplicate-rule", ERROR_INVALID_DATA};
        seen |= bit;
      }
      if (seen != (record.version == 2 ? 63u : 3u))
        throw Failure{"restart-incomplete-guard", ERROR_INVALID_DATA};
    }
    for (const auto &group : groups) {
      const auto &pair = group.second;
      ProbeRecoveryRecord record{};
      std::memcpy(&record, pair[0]->providerData.data, sizeof(record));
      if (probe_recovery_owner_alive(record) ||
          !probe_recovery_job_empty(record)) {
        ++live;
        continue;
      }
      check(FwpmTransactionBegin0(engine.value, 0), "restart-transaction");
      try {
        for (const auto *filter : pair)
          check(FwpmFilterDeleteById0(engine.value, filter->filterId),
                "restart-delete");
        check(FwpmTransactionCommit0(engine.value), "restart-commit");
      } catch (...) {
        FwpmTransactionAbort0(engine.value);
        throw;
      }
      std::vector<UINT64> deletedIds;
      for (const auto *filter : pair)
        deletedIds.push_back(filter->filterId);
      if (!removed(deletedIds))
        throw Failure{"restart-delete-unconfirmed", ERROR_INVALID_STATE};
      removedCount += static_cast<UINT32>(pair.size());
      ++assignments;
    }
  } catch (...) {
    FwpmFreeMemory0(reinterpret_cast<void **>(&app));
    throw;
  }
  FwpmFreeMemory0(reinterpret_cast<void **>(&app));
  if (!live) {
    const auto deleted =
        FwpmProviderDeleteByKey0(engine.value, &probe_recovery_provider);
    if (deleted != ERROR_SUCCESS &&
        deleted != static_cast<DWORD>(FWP_E_PROVIDER_NOT_FOUND))
      throw Failure{"restart-provider-remove", deleted};
  }
  if (publishReport)
    pipe.report("{\"phase\":\"crash-recovered\",\"assignments\":" +
                std::to_string(assignments) +
                ",\"filters\":" + std::to_string(removedCount) +
                ",\"live\":" + std::to_string(live) +
                ",\"jobsEmpty\":" + (live ? "false" : "true") + "}");
  return 0;
}
