// The private owner envelope never interprets or modifies stock RPC payloads.
// Open carries only a worker-local cache policy from the retained owner.
// Remote Data cannot select paths, executables, ports or GPUs.
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
      if (!pipe.transfer(bytes.data() + previous, static_cast<DWORD>(count),
                         received, false) ||
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
  if (!pipe.transfer(const_cast<char *>(bytes), sizeof(bytes), written, true) ||
      written != sizeof(bytes))
    throw Failure{"session-signal", GetLastError()};
}
bool probe_session_next(Pipe &pipe, ProbeFrame &frame, ULONGLONG deadline = 0) {
  frame.reset();
  size_t filled = 0;
  frame.bytes.resize(frame.expected);
  for (;;) {
    const auto now = GetTickCount64();
    auto until = deadline;
    if (frame.partialSince && (!until || frame.partialSince + 5000 < until))
      until = frame.partialSince + 5000;
    if (until && now >= until)
      throw Failure{"session-close-timeout", ERROR_TIMEOUT};
    DWORD count = 0;
    if (!pipe.transfer(frame.bytes.data() + filled,
                       static_cast<DWORD>(frame.expected - filled), count,
                       false,
                       until ? static_cast<DWORD>(until - now) : INFINITE) ||
        !count) {
      pipe.ownerGone = true;
      return false;
    }
    if (!frame.partialSince)
      frame.partialSince = GetTickCount64();
    filled += count;
    if (filled != frame.expected)
      continue;
    if (frame.expected != 4)
      return true;
    uint32_t length = 0;
    std::memcpy(&length, frame.bytes.data(), 4);
    if (!length || length > 262145)
      throw Failure{"session-frame-size", ERROR_INVALID_DATA};
    frame.expected = 4 + length;
    frame.bytes.resize(frame.expected);
  }
}
void probe_session_relay(Pipe &pipe, SOCKET socket, HANDLE logs) {
  if (!pipe.overlapped)
    throw Failure{"session-pipe-mode", ERROR_INVALID_PARAMETER};
  struct SocketEvent {
    SOCKET socket;
    WSAEVENT event = WSACreateEvent();
    explicit SocketEvent(SOCKET value) : socket(value) {
      if (event == WSA_INVALID_EVENT)
        throw Failure{"session-socket-event",
                      static_cast<DWORD>(WSAGetLastError())};
      if (WSAEventSelect(socket, event, FD_READ | FD_WRITE | FD_CLOSE)) {
        const auto error = WSAGetLastError();
        WSACloseEvent(event);
        throw Failure{"session-socket-mode", static_cast<DWORD>(error)};
      }
    }
    ~SocketEvent() {
      WSAEventSelect(socket, nullptr, 0);
      WSACloseEvent(event);
    }
  } network(socket);
  pipe.relaying = true;
  std::vector<char> input(4);
  std::vector<char> outgoing;
  std::vector<char> incoming(262149);
  // Operations are destroyed (and cancelled) before any referenced buffer.
  ProbePipeIo read, write;
  size_t filled = 0, expected = 4, sent = 0;
  ULONGLONG partialSince = 0;
  DWORD receivedPending = 0, receivedOffset = 0;
  bool reading = false, writing = false;
  bool ended = false;
  for (;;) {
    probe_drain_logs(logs);
    DWORD available = 0;
    if (!PeekNamedPipe(pipe.value, nullptr, 0, nullptr, &available, nullptr)) {
      pipe.ownerGone = true;
      return;
    }
    bool moved = false;
    WSANETWORKEVENTS events{};
    if (WSAEnumNetworkEvents(socket, network.event, &events))
      throw Failure{"session-socket-events",
                    static_cast<DWORD>(WSAGetLastError())};
    if (!reading && outgoing.empty() && !pipe.closeReceived && !ended) {
      read.start(pipe.value, input.data() + filled,
                 static_cast<DWORD>(expected - filled), false);
      reading = true;
    }
    if (reading && read.ready()) {
      reading = false;
      if (read.error || !read.count) {
        pipe.ownerGone = true;
        return;
      }
      filled += read.count;
      if (!partialSince)
        partialSince = GetTickCount64();
      moved = true;
      if (filled == expected && expected == 4) {
        uint32_t length = 0;
        std::memcpy(&length, input.data(), 4);
        if (!length || length > 262145)
          throw Failure{"session-frame-size", ERROR_INVALID_DATA};
        expected = 4 + length;
        input.resize(expected);
      } else if (filled == expected) {
        const char kind = input[4];
        if (kind == 3 && input.size() == 5)
          pipe.closeReceived = true;
        else if (kind == 2 && input.size() > 5) {
          outgoing = std::move(input);
          sent = 0;
        } else
          throw Failure{"session-command", ERROR_INVALID_DATA};
        input.assign(4, 0);
        filled = 0;
        expected = 4;
        partialSince = 0;
      }
    }
    if (!outgoing.empty() && !ended) {
      const int count = send(socket, outgoing.data() + 5 + sent,
                             static_cast<int>(outgoing.size() - 5 - sent), 0);
      if (count > 0) {
        sent += count;
        if (sent == outgoing.size() - 5)
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
    if (receivedPending && !writing) {
      write.start(pipe.value, incoming.data() + receivedOffset, receivedPending,
                  true);
      writing = true;
    }
    if (writing && write.ready()) {
      writing = false;
      if (write.error || !write.count) {
        pipe.ownerGone = true;
        return;
      }
      if (write.count > receivedPending)
        throw Failure{"session-write-size", ERROR_INVALID_DATA};
      receivedPending -= write.count;
      receivedOffset += write.count;
      moved = true;
    }
    if (!receivedPending && (pipe.closeReceived || ended))
      break;
    DWORD maintenance = 100;
    if (partialSince) {
      const auto elapsed = GetTickCount64() - partialSince;
      if (elapsed >= 5000)
        throw Failure{"session-partial-frame", ERROR_TIMEOUT};
      maintenance =
          static_cast<DWORD>(std::min<ULONGLONG>(maintenance, 5000 - elapsed));
    }
    if (!moved) {
      HANDLE handles[4]{network.event};
      DWORD count = 1;
      if (reading)
        handles[count++] = read.event();
      if (writing)
        handles[count++] = write.event();
      if (pipe.ownerProcess)
        handles[count++] = pipe.ownerProcess;
      // Data wakes immediately. The timeout only drains bounded native logs
      // and checks owner EOF while downstream writes apply backpressure.
      const auto result =
          WaitForMultipleObjects(count, handles, FALSE, maintenance);
      if (result == WAIT_FAILED)
        throw Failure{"session-readiness-wait", GetLastError()};
      if (pipe.ownerProcess && result == WAIT_OBJECT_0 + count - 1) {
        pipe.ownerGone = true;
        return;
      }
    }
  }
  pipe.relaying = false;
}
