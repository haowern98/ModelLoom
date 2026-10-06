#define WIN32_LEAN_AND_MEAN
#include <cstdio>
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
  const std::wstring mode = argc == 2 ? argv[1] : L"ready";
  const bool hidden =
      GetConsoleWindow() && !IsWindowVisible(GetConsoleWindow());
  if (!hidden)
    return 2;
  wchar_t overridden[16];
  if (GetEnvironmentVariableW(L"LLAMA_ARG_CTX_SIZE", overridden, 16) != 0)
    return 2;
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
