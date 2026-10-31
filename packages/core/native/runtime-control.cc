#define NOMINMAX
#include <cstdio>
#include <string>
#include <vector>
#include <windows.h>

namespace {
BOOL WINAPI survive(DWORD event) { return event == CTRL_C_EVENT; }
DWORD WINAPI commands(void *) {
  char command = 0;
  DWORD read = 0;
  if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), &command, 1, &read, nullptr) ||
      read != 1 || command != 'S')
    ExitProcess(3);
  // Broadcast is restricted to this helper's private console. Never attach to
  // another console.
  if (!GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0))
    ExitProcess(4);
  return 0;
}
std::wstring quote(const std::wstring &text) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t c : text) {
    if (c == L'\\') {
      ++slashes;
      continue;
    }
    result.append(c == L'\"' ? slashes * 2 + 1 : slashes, L'\\');
    result += c;
    slashes = 0;
  }
  result.append(slashes * 2, L'\\');
  return result + L'\"';
}
} // namespace
/** Privileged fixed control helper. Its owner supplies a verified executable
 * and allowlisted argv. */
int wmain(int argc, wchar_t **argv) {
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
  if (argc < 2 || argc > 129 || !GetConsoleWindow() ||
      IsWindowVisible(GetConsoleWindow()) ||
      !SetConsoleCtrlHandler(survive, TRUE))
    return 2;
  // A normal handler, not SetConsoleCtrlHandler(NULL, TRUE), keeps the child's
  // Ctrl+C enabled.
  std::wstring command = quote(argv[1]);
  for (int i = 2; i < argc; ++i)
    command += L" " + quote(argv[i]);
  if (command.size() > 32700)
    return 2;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE input =
      CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                  &security, OPEN_EXISTING, 0, nullptr);
  if (input == INVALID_HANDLE_VALUE)
    return 2;
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = input;
  startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
  std::vector<unsigned char> attributes(bytes);
  startup.lpAttributeList =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  HANDLE inherited[] = {input, startup.StartupInfo.hStdOutput};
  if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0,
                                         &bytes) ||
      !UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                                 PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited,
                                 sizeof(inherited), nullptr, nullptr)) {
    CloseHandle(input);
    return 2;
  }
  PROCESS_INFORMATION process{};
  // Both jobs are inherited. No new process group: that flag disables Ctrl+C in
  // the child.
  BOOL created =
      CreateProcessW(argv[1], command.data(), nullptr, nullptr, TRUE,
                     CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT, nullptr,
                     nullptr, &startup.StartupInfo, &process);
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  CloseHandle(input);
  if (!created)
    return 2;
  BOOL contained = FALSE;
  if (!IsProcessInJob(process.hProcess, nullptr, &contained) || !contained) {
    // The owner will terminate the whole contained tree after this helper
    // exits.
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 2;
  }
  // Fixed first line is emitted before untrusted engine output can enter the
  // pipe.
  std::printf("ENGINE %lu\n", process.dwProcessId);
  std::fflush(stdout);
  if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 2;
  }
  CloseHandle(process.hThread);
  HANDLE control = CreateThread(nullptr, 0, commands, nullptr, 0, nullptr);
  if (!control) {
    CloseHandle(process.hProcess);
    return 2;
  }
  DWORD result = WaitForSingleObject(process.hProcess, INFINITE), code = 1;
  if (result != WAIT_OBJECT_0 || !GetExitCodeProcess(process.hProcess, &code))
    code = 1;
  CloseHandle(control);
  CloseHandle(process.hProcess);
  return static_cast<int>(code);
}
