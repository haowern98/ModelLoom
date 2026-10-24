// Fixed-size opaque relay. RPC commands are parsed only inside stock RPC.
// No JSON/report bytes may be appended after the readiness line.
void probe_relay(HANDLE pipe, SOCKET socket, HANDLE logs) {
  u_long nonblocking = 1;
  if (ioctlsocket(socket, FIONBIO, &nonblocking))
    throw Failure{"relay-nonblocking", static_cast<DWORD>(WSAGetLastError())};
  DWORD mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
  if (!SetNamedPipeHandleState(pipe, &mode, nullptr, nullptr))
    throw Failure{"relay-pipe-nonblocking", GetLastError()};
  // Match the bounded pipe capacity so one scheduler wake can drain a full
  // batch. Keep these buffers off the helper's default one-MiB thread stack.
  std::vector<char> outgoing(262144), incoming(262144);
  DWORD pending = 0, offset = 0, receivedPending = 0, receivedOffset = 0;
  for (;;) {
    probe_drain_logs(logs);
    DWORD bytes = 0;
    if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &bytes, nullptr))
      return;
    if (!pending && bytes) {
      DWORD received = 0;
      if (!ReadFile(pipe, outgoing.data(),
                    std::min<DWORD>(bytes, static_cast<DWORD>(outgoing.size())),
                    &received, nullptr) ||
          !received)
        return;
      pending = received;
      offset = 0;
    }
    bool moved = false;
    if (pending) {
      const int sent =
          send(socket, outgoing.data() + offset, static_cast<int>(pending), 0);
      if (sent > 0) {
        pending -= sent;
        offset += sent;
        moved = true;
      } else if (!sent || WSAGetLastError() != WSAEWOULDBLOCK)
        return;
    }
    if (!receivedPending) {
      const int received =
          recv(socket, incoming.data(), static_cast<int>(incoming.size()), 0);
      if (received > 0) {
        receivedPending = received;
        receivedOffset = 0;
      } else if (!received || WSAGetLastError() != WSAEWOULDBLOCK)
        return;
    }
    if (receivedPending) {
      DWORD written = 0;
      if (!WriteFile(pipe, incoming.data() + receivedOffset, receivedPending,
                     &written, nullptr))
        return;
      if (written > receivedPending)
        throw Failure{"relay-pipe-write-size", ERROR_INVALID_DATA};
      receivedPending -= written;
      receivedOffset += written;
      moved = moved || written != 0;
    }
    if (!moved)
      Sleep(1);
  }
}
