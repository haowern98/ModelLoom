// The product entry shares tested ownership primitives, but admits only CUDA
// relay and recovery. Diagnostic fixtures and arbitrary endpoints are closed.
#define MODELLOOM_PEER_HOST 1
#include "../tests/native/network-guard-probe.cc"
