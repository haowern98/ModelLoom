// Ordinary-token loopback/pipe fixture. No native model, GPU, WFP or WAN.
int probe_readiness_fixture(unsigned scenario = 0) {
  WSADATA data{};
  if (WSAStartup(MAKEWORD(2, 2), &data))
    return 2;
  Socket listener, remote, worker;
  listener.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(listener.value, reinterpret_cast<sockaddr *>(&address),
           sizeof(address)) ||
      listen(listener.value, 1))
    return 3;
  int size = sizeof(address);
  if (getsockname(listener.value, reinterpret_cast<sockaddr *>(&address),
                  &size))
    return 4;
  remote.value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (connect(remote.value, reinterpret_cast<sockaddr *>(&address),
              sizeof(address)))
    return 5;
  worker.value = accept(listener.value, nullptr, nullptr);
  DWORD timeout = 10000;
  setsockopt(remote.value, SOL_SOCKET, SO_RCVTIMEO,
             reinterpret_cast<const char *>(&timeout), sizeof(timeout));
  const std::wstring name = L"\\\\.\\pipe\\ModelLoom-ready-fixture-" +
                            std::to_wstring(GetCurrentProcessId());
  ProbeHandle owner(CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX,
                                     PIPE_TYPE_BYTE | PIPE_WAIT, 1, 4096, 4096,
                                     0, nullptr));
  Pipe pipe;
  pipe.overlapped = true;
  pipe.value =
      CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                  OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
  if (owner.value == INVALID_HANDLE_VALUE || pipe.value == INVALID_HANDLE_VALUE)
    return 6;
  ProbeLogs logs;
  DWORD echoError = 0, relayError = 0;
  std::thread echo([&] {
    char buffer[65536];
    for (;;) {
      const int count = recv(worker.value, buffer, sizeof(buffer), 0);
      if (count <= 0)
        break;
      int offset = 0;
      while (offset < count) {
        const int sent = send(worker.value, buffer + offset, count - offset, 0);
        if (sent <= 0) {
          echoError = WSAGetLastError();
          return;
        }
        offset += sent;
      }
    }
  });
  std::thread relay([&] {
    try {
      if (scenario == 6) {
        pipe.framed = true;
        for (unsigned round = 0; round < 3; ++round) {
          ProbeFrame open;
          if (!probe_session_next(pipe, open) || open.bytes.size() != 5 ||
              open.bytes[4] != 1)
            throw Failure{"fixture-control", ERROR_INVALID_DATA};
          pipe.report("{\"phase\":\"relay-ready\"}");
          probe_session_signal(pipe, 3);
        }
      } else {
        probe_session_relay(pipe, remote.value, logs.read.value);
      }
    } catch (const Failure &failure) {
      relayError = failure.code;
    } catch (...) {
      relayError = ERROR_INVALID_DATA;
    }
    shutdown(remote.value, SD_BOTH);
  });
  const auto exact = [&](void *bytes, DWORD length, bool writing) {
    auto *cursor = static_cast<char *>(bytes);
    while (length) {
      DWORD count = 0;
      const bool ok =
          writing ? WriteFile(owner.value, cursor, length, &count, nullptr)
                  : ReadFile(owner.value, cursor, length, &count, nullptr);
      if (!ok || !count)
        throw Failure{"fixture-pipe-io", GetLastError()};
      cursor += count;
      length -= count;
    }
  };
  bool correct = true;
  const auto start = GetTickCount64();
  try {
    if (scenario == 1) {
      owner.close();
    } else if (scenario == 2) {
      shutdown(worker.value, SD_BOTH);
    } else if (scenario == 3) {
      uint32_t invalid = 262146;
      exact(&invalid, sizeof(invalid), true);
    } else if (scenario == 4) {
      const char partial[]{1, 0};
      exact(const_cast<char *>(partial), sizeof(partial), true);
    } else if (scenario == 5) {
      std::vector<char> frame(65541, 'x');
      const uint32_t length = 65537;
      std::memcpy(frame.data(), &length, 4);
      frame[4] = 2;
      exact(frame.data(), static_cast<DWORD>(frame.size()), true);
      // Fill the tiny owner pipe, then close with a reply write outstanding.
      Sleep(50);
      owner.close();
    } else {
      if (scenario == 6) {
        for (unsigned round = 0; round < 3; ++round) {
          char open[]{1, 0, 0, 0, 1};
          exact(open, 1, true);
          exact(open + 1, 4, true);
          uint32_t length = 0;
          exact(&length, 4, false);
          if (length != 24)
            throw Failure{"fixture-report-size", ERROR_INVALID_DATA};
          std::vector<char> report(length);
          exact(report.data(), length, false);
          correct = correct && report[0] == 1 &&
                    std::string(report.begin() + 1, report.end()) ==
                        "{\"phase\":\"relay-ready\"}";
          char closed[5];
          exact(closed, sizeof(closed), false);
          correct = correct && std::equal(closed, closed + 5, "\1\0\0\0\3");
        }
      } else {
        std::vector<char> frame(65541), received(65536);
        const uint32_t length = 65537;
        std::memcpy(frame.data(), &length, 4);
        frame[4] = 2;
        for (unsigned round = 0; round < 128; ++round) {
          for (size_t i = 5; i < frame.size(); ++i)
            frame[i] = static_cast<char>((i + round) % 251);
          // Deliberately fragment a header, then stream the rest in one write.
          exact(frame.data(), 2, true);
          exact(frame.data() + 2, static_cast<DWORD>(frame.size() - 2), true);
          if (!round)
            Sleep(50); // Exercise reply backpressure before the owner reads.
          size_t offset = 0;
          while (offset < received.size()) {
            uint32_t response = 0;
            char kind = 0;
            exact(&response, 4, false);
            exact(&kind, 1, false);
            if (kind != 2 || response < 2 ||
                response > received.size() - offset + 1)
              throw Failure{"fixture-response", ERROR_INVALID_DATA};
            exact(received.data() + offset, response - 1, false);
            offset += response - 1;
          }
          correct = correct && std::equal(received.begin(), received.end(),
                                          frame.begin() + 5);
        }
        const char close[]{1, 0, 0, 0, 3};
        exact(const_cast<char *>(close), sizeof(close), true);
      }
    }
  } catch (...) {
    correct = false;
    shutdown(remote.value, SD_BOTH);
    CancelIoEx(pipe.value, nullptr);
    CancelSynchronousIo(relay.native_handle());
  }
  relay.join();
  echo.join();
  const auto milliseconds = GetTickCount64() - start;
  const DWORD expectedError = scenario == 3   ? ERROR_INVALID_DATA
                              : scenario == 4 ? ERROR_TIMEOUT
                                              : 0;
  correct = correct && relayError == expectedError && !echoError &&
            ((scenario != 1 && scenario != 5) || pipe.ownerGone);
  std::printf(
      "{\"scenario\":%u,\"correct\":%s,\"relayError\":%lu,\"echoError\":%lu,"
      "\"bytes\":%u,\"milliseconds\":%llu}\n",
      scenario, correct ? "true" : "false", relayError, echoError,
      scenario ? 0 : 8388608, milliseconds);
  return correct ? 0 : 7;
}
