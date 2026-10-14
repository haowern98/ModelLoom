// Private implementation included after the ownership binding's tagged handles.
constexpr napi_type_tag credential_tag = {0x7281e7462e234735,
                                          0xa21f831f4f09d601};
struct Credential {
  Handle pipe, event;
  OVERLAPPED operation{};
  std::wstring name;
  std::vector<char> bytes;
  uint64_t deployment_identity = 0, server_identity = 0;
  enum class Stage { connecting, connected, writing, delivered };
  Stage stage = Stage::connecting;
  bool pending = false;
  void close() {
    if (pipe.value && pending) {
      // Drain cancellation before freeing OVERLAPPED/event/buffer memory.
      CancelIoEx(pipe.value, &operation);
      DWORD transferred = 0;
      GetOverlappedResult(pipe.value, &operation, &transferred, TRUE);
      pending = false;
    }
    pipe.reset();
    event.reset();
    SecureZeroMemory(bytes.data(), bytes.size());
  }
  ~Credential() { close(); }
};

/** Local-only, non-inherited one-use stream. No disk file or duplicate job
 * handle can prolong the secret or deployment lifetime. */
napi_value create_credential(napi_env env, napi_callback_info info) {
  napi_value values[3];
  std::wstring nonce;
  size_t secret_size = 0;
  if (!arguments(env, info, 3, values) || !wide(env, values[1], nonce) ||
      napi_get_value_string_utf8(env, values[2], nullptr, 0, &secret_size) !=
          napi_ok)
    return fail(env, "INVALID_CONTROL");
  auto *root = unwrap<Deployment>(env, values[0], root_tag);
  if (!root || !root->job.value || nonce.size() != 36 || secret_size != 43)
    return fail(env, "INVALID_CONTROL");
  for (size_t i = 0; i < nonce.size(); ++i) {
    const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
    if (dash ? nonce[i] != L'-'
             : !((nonce[i] >= L'0' && nonce[i] <= L'9') ||
                 (nonce[i] >= L'a' && nonce[i] <= L'f')))
      return fail(env, "INVALID_CONTROL");
  }
  auto credential = std::make_unique<Credential>();
  credential->bytes.resize(45);
  if (napi_get_value_string_utf8(env, values[2], credential->bytes.data(), 44,
                                 &secret_size) != napi_ok ||
      secret_size != 43)
    return fail(env, "INVALID_CONTROL");
  for (size_t i = 0; i < secret_size; ++i) {
    const char c = credential->bytes[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_'))
      return fail(env, "INVALID_CONTROL");
  }
  Handle token;
  HANDLE raw = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw))
    return fail(env, "OWNERSHIP_FAILED");
  token.reset(raw);
  DWORD size = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
  std::vector<unsigned char> user(size);
  if (!GetTokenInformation(token.value, TokenUser, user.data(), size, &size))
    return fail(env, "OWNERSHIP_FAILED");
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(
          reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid, &sid))
    return fail(env, "OWNERSHIP_FAILED");
  const std::wstring sddl =
      L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(sid) + L")";
  LocalFree(sid);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
    return fail(env, "OWNERSHIP_FAILED");
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor,
                                 FALSE};
  credential->name = L"\\\\.\\pipe\\ModelLoom-key-" + nonce;
  credential->deployment_identity = root->identity;
  credential->pipe.reset(
      CreateNamedPipeW(credential->name.c_str(),
                       PIPE_ACCESS_OUTBOUND | FILE_FLAG_OVERLAPPED |
                           FILE_FLAG_FIRST_PIPE_INSTANCE,
                       PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT |
                           PIPE_REJECT_REMOTE_CLIENTS,
                       1, 64, 64, 0, &attributes));
  LocalFree(descriptor);
  if (credential->pipe.value == INVALID_HANDLE_VALUE) {
    credential->pipe.value = nullptr;
    return fail(env, "OWNERSHIP_FAILED");
  }
  credential->event.reset(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  if (!credential->event.value)
    return fail(env, "OWNERSHIP_FAILED");
  credential->operation.hEvent = credential->event.value;
  credential->bytes[43] = '\n';
  // The pinned Windows text reader treats Ctrl+Z as EOF. Retain the pipe until
  // authenticated readiness rather than closing an unread outbound buffer.
  credential->bytes[44] = '\x1a';
  if (ConnectNamedPipe(credential->pipe.value, &credential->operation))
    credential->stage = Credential::Stage::connected;
  else {
    const DWORD error = GetLastError();
    if (error == ERROR_PIPE_CONNECTED)
      credential->stage = Credential::Stage::connected;
    else if (error == ERROR_IO_PENDING)
      credential->pending = true;
    else
      return fail(env, "OWNERSHIP_FAILED");
  }
  return wrap(env, std::move(credential), credential_tag);
}

napi_value credential_path(napi_env env, napi_callback_info info) {
  napi_value values[1], result;
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *credential = unwrap<Credential>(env, values[0], credential_tag);
  if (!credential || !credential->pipe.value ||
      napi_create_string_utf16(
          env, reinterpret_cast<const char16_t *>(credential->name.data()),
          credential->name.size(), &result) != napi_ok)
    return fail(env, "INVALID_CONTROL");
  return result;
}

/** Polls without blocking main. Checks retained live server/job/client identity
 * before any byte, and binds the stream to that exact native launch capability.
 */
napi_value deliver_credential(napi_env env, napi_callback_info info) {
  napi_value values[2], result;
  if (!arguments(env, info, 2, values))
    return fail(env, "INVALID_CONTROL");
  auto *credential = unwrap<Credential>(env, values[0], credential_tag);
  auto *child = unwrap<Child>(env, values[1], child_tag);
  if (!credential || !credential->pipe.value || !child || !child->server.value)
    return fail(env, "INVALID_CONTROL");
  BOOL contained = FALSE;
  if (credential->deployment_identity != child->deployment_identity ||
      (credential->server_identity &&
       credential->server_identity != child->identity) ||
      WaitForSingleObject(child->server.value, 0) != WAIT_TIMEOUT ||
      !IsProcessInJob(child->server.value, child->job.value, &contained) ||
      !contained)
    return fail(env, "OWNERSHIP_FAILED");
  DWORD transferred = 0;
  if (credential->pending) {
    if (!GetOverlappedResult(credential->pipe.value, &credential->operation,
                             &transferred, FALSE)) {
      if (GetLastError() == ERROR_IO_INCOMPLETE)
        return napi_get_boolean(env, false, &result) == napi_ok
                   ? result
                   : fail(env, "OWNERSHIP_FAILED");
      return fail(env, "OWNERSHIP_FAILED");
    }
    credential->pending = false;
    if (credential->stage == Credential::Stage::writing) {
      if (transferred != credential->bytes.size())
        return fail(env, "OWNERSHIP_FAILED");
      credential->stage = Credential::Stage::delivered;
    } else
      credential->stage = Credential::Stage::connected;
  }
  if (credential->stage == Credential::Stage::connected) {
    ULONG client = 0;
    if (!GetNamedPipeClientProcessId(credential->pipe.value, &client) ||
        client != GetProcessId(child->server.value))
      return fail(env, "OWNERSHIP_FAILED");
    credential->server_identity = child->identity;
    ResetEvent(credential->event.value);
    credential->operation = {};
    credential->operation.hEvent = credential->event.value;
    credential->stage = Credential::Stage::writing;
    if (WriteFile(credential->pipe.value, credential->bytes.data(),
                  static_cast<DWORD>(credential->bytes.size()), &transferred,
                  &credential->operation)) {
      if (!GetOverlappedResult(credential->pipe.value, &credential->operation,
                               &transferred, FALSE) ||
          transferred != credential->bytes.size())
        return fail(env, "OWNERSHIP_FAILED");
      credential->stage = Credential::Stage::delivered;
    } else if (GetLastError() == ERROR_IO_PENDING)
      credential->pending = true;
    else
      return fail(env, "OWNERSHIP_FAILED");
  }
  const bool delivered = credential->stage == Credential::Stage::delivered;
  if (delivered)
    SecureZeroMemory(credential->bytes.data(), credential->bytes.size());
  return napi_get_boolean(env, delivered, &result) == napi_ok
             ? result
             : fail(env, "OWNERSHIP_FAILED");
}

napi_value release_credential(napi_env env, napi_callback_info info) {
  napi_value values[1];
  if (!arguments(env, info, 1, values))
    return fail(env, "INVALID_CONTROL");
  auto *credential = unwrap<Credential>(env, values[0], credential_tag);
  if (!credential)
    return fail(env, "INVALID_CONTROL");
  credential->close();
  return nothing(env);
}
