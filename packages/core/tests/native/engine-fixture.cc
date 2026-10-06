#define NOMINMAX
#include <cstdio>
#include <cstdlib>
#include <string>
#include <windows.h>

// Harmless local fixture: no model, network listener, file writes or external
// executable.
int wmain(int argc, wchar_t **argv) {
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
  const std::wstring mode = argc == 2 ? argv[1] : L"ready";
  if (mode == L"leaf") {
    Sleep(INFINITE);
    return 0;
  }
  if (mode == L"descendant") {
    wchar_t image[32768];
    if (!GetModuleFileNameW(nullptr, image, 32768))
      return 2;
    std::wstring command = L"\"" + std::wstring(image) + L"\" leaf";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(image, command.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process))
      return 2;
    std::printf("CHILD %lu\n", process.dwProcessId);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
  }
  if (mode != L"loading") {
    std::printf("READY\n");
    std::fflush(stdout);
  }
  for (;;) {
    char command = 0;
    DWORD read = 0;
    if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), &command, 1, &read,
                  nullptr) ||
        read == 0)
      return 0;
    if (command == 'A') {
      // Real ordinary native failure, distinct from TerminateJobObject in
      // forced cleanup.
      RaiseException(EXCEPTION_ACCESS_VIOLATION, EXCEPTION_NONCONTINUABLE, 0,
                     nullptr);
      return 3;
    }
    if (command == 'S' && mode != L"hang" && mode != L"descendant")
      return 0;
  }
}
