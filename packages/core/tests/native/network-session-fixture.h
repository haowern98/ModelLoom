// Ordinary-token parser regression. No filters, elevation, sockets or workers.
int probe_session_frame_fixture() {
  Pipe pipe;
  ProbeHandle writer;
  if (!CreatePipe(&pipe.value, &writer.value, nullptr, 65536))
    return 2;
  const auto write = [&](const std::vector<char> &bytes) {
    DWORD written = 0;
    if (!WriteFile(writer.value, bytes.data(), static_cast<DWORD>(bytes.size()),
                   &written, nullptr) ||
        written != bytes.size())
      throw Failure{"fixture-write", GetLastError()};
  };
  std::vector<char> bytes(8197, 'x');
  const uint32_t length = 8193;
  std::memcpy(bytes.data(), &length, 4);
  bytes[4] = 2;
  write(bytes);
  ProbeFrame frame;
  // A complete buffered frame must not require a scheduler yield after its
  // header.
  if (!frame.step(pipe) || frame.bytes != bytes)
    return 3;
  frame.reset();
  write(std::vector<char>(bytes.begin(), bytes.begin() + 2));
  if (frame.step(pipe))
    return 4;
  write(std::vector<char>(bytes.begin() + 2, bytes.end()));
  if (!frame.step(pipe) || frame.bytes != bytes)
    return 5;
  frame.reset();
  const std::vector<char> pair{1, 0, 0, 0, 1, 1, 0, 0, 0, 3};
  write(pair);
  if (!frame.step(pipe) || frame.bytes.size() != 5 || frame.bytes[4] != 1)
    return 6;
  frame.reset();
  if (!frame.step(pipe) || frame.bytes.size() != 5 || frame.bytes[4] != 3)
    return 7;
  for (const uint32_t invalid : {0u, 262146u}) {
    frame.reset();
    std::vector<char> header(4);
    std::memcpy(header.data(), &invalid, 4);
    write(header);
    bool denied = false;
    try {
      frame.step(pipe);
    } catch (const Failure &failure) {
      denied = failure.code == ERROR_INVALID_DATA;
    }
    if (!denied)
      return 8;
  }
  frame.reset();
  writer.close();
  if (frame.step(pipe) || !pipe.ownerGone)
    return 9;
  std::puts("{\"complete\":true,\"fragmented\":true,\"sequential\":true,"
            "\"bounded\":true,\"ownerLoss\":true}");
  return 0;
}
