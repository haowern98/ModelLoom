// The allowed source socket is bound exclusively before admission. A second
// process at the same image path cannot acquire that live endpoint. An enabled
// administrator token is also required, so ordinary copies stay denied after
// owner loss even if the source port is subsequently reused.
struct ProbeInstanceRules {
  ProbeRules &base;
  std::vector<UINT64> ids;
  explicit ProbeInstanceRules(ProbeRules &rules) : base(rules) {}
  void remove() {
    for (const auto id : ids)
      check(FwpmFilterDeleteById0(base.engine.value, id), "instance-rule-delete");
    if (!removed(ids))
      throw Failure{"instance-delete-unconfirmed", ERROR_INVALID_STATE};
    ids.clear();
  }
  ~ProbeInstanceRules() {
    if (base.safeToRemove)
      for (const auto id : ids)
        FwpmFilterDeleteById0(base.engine.value, id);
  }
  void install(UINT16 port, UINT16 source, const GUID *provider = nullptr,
               const FWP_BYTE_BLOB *record = nullptr) {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            L"D:(A;;CC;;;BA)", SDDL_REVISION_1, &descriptor, nullptr))
      throw Failure{"instance-admin-descriptor", GetLastError()};
    FWP_BYTE_BLOB security{GetSecurityDescriptorLength(descriptor),
                           static_cast<BYTE *>(descriptor)};
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
        ipv6.addr[10] = ipv6.addr[11] = 0xff;
        ipv6.addr[12] = 127;
        ipv6.addr[15] = 1;
        ipv6.prefixLength = 128;
        conditions[2].fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
        conditions[2].matchType = FWP_MATCH_EQUAL;
        conditions[2].conditionValue.type = family ? FWP_V6_ADDR_MASK : FWP_V4_ADDR_MASK;
        if (family)
          conditions[2].conditionValue.v6AddrMask = &ipv6;
        else
          conditions[2].conditionValue.v4AddrMask = &ipv4;
        for (int kind = 0; kind < 2; ++kind) {
          conditions[3] = {};
          conditions[3].matchType = FWP_MATCH_NOT_EQUAL;
          if (kind) {
            conditions[3].fieldKey = FWPM_CONDITION_ALE_USER_ID;
            conditions[3].conditionValue.type = FWP_SECURITY_DESCRIPTOR_TYPE;
            conditions[3].conditionValue.sd = &security;
          } else {
            conditions[3].fieldKey = FWPM_CONDITION_IP_LOCAL_PORT;
            conditions[3].conditionValue.type = FWP_UINT16;
            conditions[3].conditionValue.uint16 = source;
          }
          FWPM_FILTER0 filter{};
          filter.providerKey = const_cast<GUID *>(provider);
          if (record)
            filter.providerData = *record;
          filter.displayData.name = const_cast<wchar_t *>(L"ModelLoom owned-source diagnostic");
          filter.layerKey = family ? FWPM_LAYER_ALE_AUTH_CONNECT_V6 : FWPM_LAYER_ALE_AUTH_CONNECT_V4;
          filter.subLayerKey = FWPM_SUBLAYER_UNIVERSAL;
          filter.action.type = FWP_ACTION_BLOCK;
          filter.weight.type = FWP_UINT8;
          filter.weight.uint8 = 15;
          filter.numFilterConditions = 4;
          filter.filterCondition = conditions;
          UINT64 id = 0;
          check(FwpmFilterAdd0(base.engine.value, &filter, nullptr, &id), "instance-rule-add");
          ids.push_back(id);
        }
      }
    } catch (...) {
      LocalFree(descriptor);
      throw;
    }
    LocalFree(descriptor);
  }
};
