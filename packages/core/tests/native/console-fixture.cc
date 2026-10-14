#define WIN32_LEAN_AND_MEAN
#include <cstdio>
#include <fstream>
#include <string>
#include <windows.h>
#include <winsock2.h>
namespace {
volatile LONG stopping = 0;
BOOL WINAPI stop(DWORD event) {
  if (event != CTRL_C_EVENT)
    return FALSE;
  InterlockedExchange(&stopping, 1);
  return TRUE;
}
} // namespace
// Harmless synthetic console handler. This proves signal delivery, not upstream
// model cleanup.
int wmain(int argc, wchar_t **argv) {
  const std::wstring mode = argc >= 2 ? argv[1] : L"ready";
  const bool hidden =
      GetConsoleWindow() && !IsWindowVisible(GetConsoleWindow());
  if (!hidden)
    return 2;
  wchar_t overridden[16];
  if (GetEnvironmentVariableW(L"LLAMA_ARG_CTX_SIZE", overridden, 16) != 0)
    return 2;
  if (mode == L"credential") {
    if (argc != 3)
      return 2;
    std::ifstream stream(argv[2]);
    std::string key, extra;
    if (!stream) {
      std::puts("CREDENTIAL OPEN FAILED");
      std::fflush(stdout);
      return 6;
    }
    if (!std::getline(stream, key) || key != std::string(43, 'A')) {
      std::puts("CREDENTIAL CONTENT FAILED");
      std::fflush(stdout);
      return 6;
    }
    if (std::getline(stream, extra)) {
      std::puts("CREDENTIAL EOF FAILED");
      std::fflush(stdout);
      return 6;
    }
    std::puts("CREDENTIAL RECEIVED");
    std::fflush(stdout);
  }
  if (mode == L"gpu") {
    wchar_t gpu[128]{};
    SetLastError(ERROR_SUCCESS);
    const auto count =
        GetEnvironmentVariableW(L"CUDA_VISIBLE_DEVICES", gpu, 128);
    if (count >= 128 || (!count && GetLastError() == ERROR_ENVVAR_NOT_FOUND))
      return 2;
    std::printf("GPU %ls\n", count ? gpu : L"NONE");
    std::fflush(stdout);
  }
  if (mode == L"directories") {
    wchar_t current[32768]{}, path[32768]{}, cache[32768]{}, limit[32]{};
    if (!GetCurrentDirectoryW(32768, current) ||
        !GetEnvironmentVariableW(L"PATH", path, 32768) ||
        !GetEnvironmentVariableW(L"CUDA_CACHE_PATH", cache, 32768) ||
        !GetEnvironmentVariableW(L"CUDA_CACHE_MAXSIZE", limit, 32))
      return 2;
    std::printf("CWD %ls\nPATH %ls\nCACHE %ls\nCACHE LIMIT %ls\n", current,
                path, cache, limit);
    std::fflush(stdout);
  }
  SOCKET listener = INVALID_SOCKET;
  if (mode == L"listen") {
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0)
      return 2;
    listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int length = sizeof(address);
    if (listener == INVALID_SOCKET ||
        bind(listener, reinterpret_cast<const sockaddr *>(&address),
             sizeof(address)) != 0 ||
        listen(listener, 1) != 0 ||
        getsockname(listener, reinterpret_cast<sockaddr *>(&address),
                    &length) != 0)
      return 2;
    std::printf("PORT %u\n", static_cast<unsigned>(ntohs(address.sin_port)));
    std::fflush(stdout);
  }
  if (mode == L"loading") {
    std::printf("LOADING HIDDEN\n");
    std::fflush(stdout);
    Sleep(INFINITE);
    return 0;
  }
  if (!SetConsoleCtrlHandler(stop, TRUE))
    return 2;
  std::printf("READY HIDDEN\n");
  std::fflush(stdout);
  while (!InterlockedCompareExchange(&stopping, 0, 0))
    Sleep(10);
  // Synthetic native fault for containment tests; no production engine code.
  if (mode == L"fault")
    RaiseException(0xE0421001, EXCEPTION_NONCONTINUABLE, 0, nullptr);
  if (mode == L"hang")
    Sleep(INFINITE);
  if (listener != INVALID_SOCKET) {
    closesocket(listener);
    WSACleanup();
  }
  std::printf("CLEANUP\n");
  std::fflush(stdout);
  return 0;
}
