// The private owner envelope never interprets or modifies stock RPC payloads.
// Control has no executable/path/port/GPU arguments. All storage is bounded.
struct ProbeFrame {
  std::vector<char> bytes;
  size_t expected = 4;
  ULONGLONG partialSince = 0;
  bool step(Pipe &pipe) {
    // Read header and already-buffered payload in the same wake. Yielding
    // between them throttles every 8-KiB IPC fragment to the Windows timer
    // tick.
    for (;;) {
      DWORD available = 0;
      if (!PeekNamedPipe(pipe.value, nullptr, 0, nullptr, &available,
                         nullptr)) {
        pipe.ownerGone = true;
        return false;
      }
      if (partialSince && GetTickCount64() - partialSince > 5000)
        throw Failure{"session-partial-frame", ERROR_TIMEOUT};
      if (bytes.size() == expected)
        return true;
      if (!available)
        return false;
      if (!partialSince)
        partialSince = GetTickCount64();
      const auto previous = bytes.size();
      const auto count = std::min<size_t>(available, expected - previous);
      bytes.resize(previous + count);
      DWORD received = 0;
      if (!ReadFile(pipe.value, bytes.data() + previous,
                    static_cast<DWORD>(count), &received, nullptr) ||
          received != count) {
        pipe.ownerGone = true;
        return false;
      }
      if (expected == 4 && bytes.size() == 4) {
        uint32_t length = 0;
        std::memcpy(&length, bytes.data(), 4);
        if (!length || length > 262145)
          throw Failure{"session-frame-size", ERROR_INVALID_DATA};
        expected = 4 + length;
      }
      if (bytes.size() == expected)
        return true;
    }
  }
  void reset() {
    bytes.clear();
    expected = 4;
    partialSince = 0;
  }
};
void probe_session_signal(Pipe &pipe, char kind) {
  const char bytes[]{1, 0, 0, 0, kind};
  DWORD written = 0;
  if (!WriteFile(pipe.value, bytes, sizeof(bytes), &written, nullptr) ||
      written != sizeof(bytes))
    throw Failure{"session-signal", GetLastError()};
}
bool probe_session_next(Pipe &pipe, ProbeFrame &frame, ULONGLONG deadline = 0) {
  while (!frame.step(pipe)) {
    if (pipe.ownerGone)
      return false;
    if (deadline && GetTickCount64() >= deadline)
      throw Failure{"session-close-timeout", ERROR_TIMEOUT};
    Sleep(1);
  }
  return true;
}
void probe_session_relay(Pipe &pipe, SOCKET socket, HANDLE logs) {
  u_long nonblocking = 1;
  if (ioctlsocket(socket, FIONBIO, &nonblocking))
    throw Failure{"session-socket-mode", static_cast<DWORD>(WSAGetLastError())};
  DWORD mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
  check(SetNamedPipeHandleState(pipe.value, &mode, nullptr, nullptr)
            ? ERROR_SUCCESS
            : GetLastError(),
        "session-pipe-mode");
  ProbeFrame input;
  std::vector<char> outgoing;
  std::vector<char> incoming(262149);
  size_t sent = 0;
  DWORD receivedPending = 0, receivedOffset = 0;
  bool ended = false;
  for (;;) {
    probe_drain_logs(logs);
    DWORD available = 0;
    if (!PeekNamedPipe(pipe.value, nullptr, 0, nullptr, &available, nullptr)) {
      pipe.ownerGone = true;
      return;
    }
    bool moved = false;
    if (outgoing.empty() && !pipe.closeReceived && !ended && input.step(pipe)) {
      const char kind = input.bytes[4];
      if (kind == 3 && input.bytes.size() == 5)
        pipe.closeReceived = true;
      else if (kind == 2 && input.bytes.size() > 5) {
        outgoing.assign(input.bytes.begin() + 5, input.bytes.end());
        sent = 0;
      } else
        throw Failure{"session-command", ERROR_INVALID_DATA};
      input.reset();
      moved = true;
    }
    if (!outgoing.empty() && !ended) {
      const int count = send(socket, outgoing.data() + sent,
                             static_cast<int>(outgoing.size() - sent), 0);
      if (count > 0) {
        sent += count;
        if (sent == outgoing.size())
          outgoing.clear();
        moved = true;
      } else if (!count || WSAGetLastError() != WSAEWOULDBLOCK)
        ended = true;
    }
    if (!receivedPending && !ended && !pipe.closeReceived) {
      const int count = recv(socket, incoming.data() + 5, 262144, 0);
      if (count > 0) {
        const uint32_t size = static_cast<uint32_t>(count + 1);
        std::memcpy(incoming.data(), &size, 4);
        incoming[4] = 2;
        receivedPending = static_cast<DWORD>(count + 5);
        receivedOffset = 0;
      } else if (!count || WSAGetLastError() != WSAEWOULDBLOCK)
        ended = true;
    }
    if (receivedPending) {
      DWORD written = 0;
      if (!WriteFile(pipe.value, incoming.data() + receivedOffset,
                     receivedPending, &written, nullptr) &&
          GetLastError() != ERROR_NO_DATA) {
        pipe.ownerGone = true;
        return;
      }
      if (written > receivedPending)
        throw Failure{"session-write-size", ERROR_INVALID_DATA};
      receivedPending -= written;
      receivedOffset += written;
      moved = moved || written != 0;
    }
    if (!receivedPending && (pipe.closeReceived || ended))
      break;
    // Loaded models may be idle indefinitely. Owner EOF, explicit stop and
    // worker disconnect govern lifetime; RPC silence is not a failure.
    if (!moved)
      Sleep(1);
  }
  mode = PIPE_READMODE_BYTE | PIPE_WAIT;
  check(SetNamedPipeHandleState(pipe.value, &mode, nullptr, nullptr)
            ? ERROR_SUCCESS
            : GetLastError(),
        "session-pipe-mode");
}
