#include "../../native/tensor-cache-policy.h"
// Elevation lasts only as long as the authenticated ordinary owner's pipe.
// Worker exit and guard removal complete before accepting another Open.
int probe_session(Pipe &pipe, bool cuda) {
  probe_recover_crash(pipe, false);
  pipe.report("{\"phase\":\"helper-ready\"}");
  pipe.framed = true;
  for (;;) {
    ProbeFrame command;
    if (!probe_session_next(pipe, command))
      return 0;
    if (command.bytes.size() < 5 || command.bytes[4] != 1)
      throw Failure{"session-open", ERROR_INVALID_DATA};
    try {
      modelloom::apply_cache_policy(command.bytes.data() + 5,
                                    command.bytes.size() - 5);
    } catch (...) {
      throw Failure{"session-cache-policy", ERROR_INVALID_DATA};
    }
    pipe.closeReceived = false;
    probe_runtime_tail.clear();
    probe_rpc(pipe, true, true, true, cuda);
    if (pipe.ownerGone)
      return 0;
    if (!pipe.closeReceived) {
      probe_session_signal(pipe, 4);
      const auto deadline = GetTickCount64() + 10000;
      do {
        command.reset();
        if (!probe_session_next(pipe, command, deadline))
          return 0;
        if (GetTickCount64() >= deadline)
          throw Failure{"session-close-timeout", ERROR_TIMEOUT};
        if (command.bytes.size() == 5 && command.bytes[4] == 3)
          pipe.closeReceived = true;
        else if (command.bytes.size() <= 5 || command.bytes[4] != 2)
          throw Failure{"session-close", ERROR_INVALID_DATA};
      } while (!pipe.closeReceived);
    }
    probe_session_signal(pipe, 3);
  }
}
