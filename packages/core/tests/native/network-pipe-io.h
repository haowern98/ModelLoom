// One bounded overlapped operation. Cancellation completes before its buffer is
// released.
class ProbePipeIo {
  HANDLE file = INVALID_HANDLE_VALUE;
  OVERLAPPED operation{};
  bool pending = false;
  bool complete = false;

public:
  DWORD count = 0, error = ERROR_SUCCESS;
  ProbePipeIo() {
    operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!operation.hEvent)
      throw Failure{"pipe-event", GetLastError()};
  }
  ProbePipeIo(const ProbePipeIo &) = delete;
  ProbePipeIo &operator=(const ProbePipeIo &) = delete;
  ~ProbePipeIo() {
    if (pending) {
      CancelIoEx(file, &operation);
      DWORD ignored = 0;
      GetOverlappedResult(file, &operation, &ignored, TRUE);
    }
    CloseHandle(operation.hEvent);
  }
  HANDLE event() const { return operation.hEvent; }
  void start(HANDLE handle, void *bytes, DWORD length, bool writing) {
    if (pending)
      throw Failure{"pipe-operation-busy", ERROR_INVALID_STATE};
    file = handle;
    ResetEvent(operation.hEvent);
    count = 0;
    error = ERROR_SUCCESS;
    complete = false;
    const BOOL result = writing
                            ? WriteFile(file, bytes, length, &count, &operation)
                            : ReadFile(file, bytes, length, &count, &operation);
    pending = !result && GetLastError() == ERROR_IO_PENDING;
    if (!pending) {
      error = result ? ERROR_SUCCESS : GetLastError();
      complete = true;
      SetEvent(operation.hEvent);
    }
  }
  bool ready() {
    if (pending) {
      if (GetOverlappedResult(file, &operation, &count, FALSE)) {
        error = ERROR_SUCCESS;
      } else {
        error = GetLastError();
        if (error == ERROR_IO_INCOMPLETE)
          return false;
      }
      pending = false;
      complete = true;
    }
    return complete;
  }
  bool wait(DWORD timeout) {
    if (!ready()) {
      const DWORD result = WaitForSingleObject(event(), timeout);
      if (result == WAIT_TIMEOUT)
        throw Failure{"session-partial-frame", ERROR_TIMEOUT};
      if (result != WAIT_OBJECT_0)
        throw Failure{"pipe-wait", GetLastError()};
    }
    return ready() && !error;
  }
};
