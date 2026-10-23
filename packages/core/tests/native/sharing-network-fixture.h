// No privilege, listeners or firewall mutation. Exercise the product parsers
// with hostile inputs.
int sharing_policy_fixture() {
  for (const auto *text :
       {L"127.0.0.1", L"10.0.0.1", L"172.16.0.1", L"172.31.255.254",
        L"192.168.0.1", L"100.64.0.1", L"100.127.255.254"})
    sharing_address(text);
  for (const auto *text :
       {L"0.0.0.0", L"8.8.8.8", L"172.32.0.1", L"100.128.0.1", L"010.0.0.1",
        L"localhost", L"100.77.238.117/10"}) {
    bool denied = false;
    try {
      sharing_address(text);
    } catch (const Failure &) {
      denied = true;
    }
    if (!denied)
      throw Failure{"sharing-fixture-address", ERROR_INVALID_STATE};
  }
  const std::wstring id = L"0123456789abcdef0123456789abcdef";
  if (sharing_rule_address(L"127.0.0.1/255.255.255.255") != L"127.0.0.1" ||
      sharing_rule_address(L"10.0.0.1/32") != L"10.0.0.1")
    throw Failure{"sharing-fixture-normalization", ERROR_INVALID_STATE};
  bool broad = false;
  try {
    sharing_rule_address(L"10.0.0.1/24");
  } catch (const Failure &) {
    broad = true;
  }
  if (!broad)
    throw Failure{"sharing-fixture-normalization", ERROR_INVALID_STATE};
  const auto name = std::wstring(sharing_prefix) + id;
  const std::wstring prefix = L"ModelLoomSharingV1:";
  SharingRecord record;
  if (!sharing_record(name, prefix + L"123:456:" + id, record) ||
      record.owner != 123 || record.created != 456)
    throw Failure{"sharing-fixture-record", ERROR_INVALID_STATE};
  for (const auto &description :
       {prefix + L"0:456:" + id, prefix + L"123:0:" + id,
        prefix + L"4294967296:456:" + id,
        prefix + L"123:18446744073709551616:" + id, prefix + L"0123:456:" + id,
        prefix + L"123:456:" + id + L":extra",
        prefix + L"123:456:fedcba9876543210fedcba9876543210"})
    if (sharing_record(name, description, record))
      throw Failure{"sharing-fixture-record", ERROR_INVALID_STATE};
  std::puts(
      "{\"phase\":\"sharing-policy-checked\",\"addresses\":14,\"records\":8}");
  return 0;
}
