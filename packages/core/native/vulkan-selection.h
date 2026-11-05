#pragma once
#define VK_NO_PROTOTYPES
#include <vulkan/vulkan_core.h>
#include <algorithm>
#include <string>
#include <stdexcept>
#include <vector>

namespace modelloom {
// Map stable physical UUIDs before the child can allocate on a Vulkan device.
// This helper is compiled only into the separate Vulkan package.
inline std::wstring vulkan_devices(const std::wstring &requested) {
  if (!SetEnvironmentVariableW(L"VK_LOADER_LAYERS_DISABLE", L"~implicit~"))
    throw std::runtime_error("VULKAN_ENVIRONMENT_FAILED");
  HMODULE loader = LoadLibraryExW(L"vulkan-1.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!loader) throw std::runtime_error("VULKAN_UNAVAILABLE");
  struct Library { HMODULE value; ~Library() { FreeLibrary(value); } } library{loader};
  auto entry = reinterpret_cast<PFN_vkGetInstanceProcAddr>(GetProcAddress(loader, "vkGetInstanceProcAddr"));
  if (!entry) throw std::runtime_error("VULKAN_UNAVAILABLE");
  auto create = reinterpret_cast<PFN_vkCreateInstance>(entry(nullptr, "vkCreateInstance"));
  VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
  app.apiVersion = VK_API_VERSION_1_1;
  VkInstanceCreateInfo info{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
  info.pApplicationInfo = &app;
  VkInstance instance{};
  if (!create || create(&info, nullptr, &instance) != VK_SUCCESS) throw std::runtime_error("VULKAN_UNAVAILABLE");
  auto destroy = reinterpret_cast<PFN_vkDestroyInstance>(entry(instance, "vkDestroyInstance"));
  if (!destroy) throw std::runtime_error("VULKAN_UNAVAILABLE");
  struct Instance { VkInstance value; PFN_vkDestroyInstance destroy; ~Instance() { destroy(value, nullptr); } } owned{instance, destroy};
  auto enumerate = reinterpret_cast<PFN_vkEnumeratePhysicalDevices>(entry(instance, "vkEnumeratePhysicalDevices"));
  auto properties = reinterpret_cast<PFN_vkGetPhysicalDeviceProperties2>(entry(instance, "vkGetPhysicalDeviceProperties2"));
  uint32_t count = 0;
  if (!enumerate || !properties || enumerate(instance, &count, nullptr) != VK_SUCCESS || count == 0 || count > 32)
    throw std::runtime_error("VULKAN_UNAVAILABLE");
  std::vector<VkPhysicalDevice> devices(count);
  if (enumerate(instance, &count, devices.data()) != VK_SUCCESS) throw std::runtime_error("VULKAN_UNAVAILABLE");
  std::vector<std::wstring> uuids;
  for (const auto device : devices) {
    VkPhysicalDeviceIDProperties id{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES};
    VkPhysicalDeviceProperties2 props{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
    props.pNext = &id;
    properties(device, &props);
    std::wstring uuid = L"gpu-";
    constexpr wchar_t hex[] = L"0123456789abcdef";
    for (size_t i = 0; i < VK_UUID_SIZE; ++i) {
      if (i == 4 || i == 6 || i == 8 || i == 10) uuid += L'-';
      uuid += hex[id.deviceUUID[i] >> 4];
      uuid += hex[id.deviceUUID[i] & 15];
    }
    uuids.push_back(uuid);
  }
  std::wstring indices;
  size_t first = 0;
  do {
    const auto end = requested.find(L',', first);
    auto uuid = requested.substr(first, end == std::wstring::npos ? end : end - first);
    std::transform(uuid.begin(), uuid.end(), uuid.begin(), [](wchar_t c) { return c >= L'A' && c <= L'Z' ? wchar_t(c + 32) : c; });
    if (uuid.size() != 40 || uuid.substr(0, 4) != L"gpu-") throw std::runtime_error("INVALID_GPU_RESERVATION");
    size_t index = uuids.size();
    for (size_t i = 0; i < uuids.size(); ++i) {
      if (uuids[i] == uuid) {
        // Multiple ICD entries can represent the same physical GPU, as in ggml's own deduplication.
        index = i;
        break;
      }
    }
    if (index == uuids.size()) throw std::runtime_error("VULKAN_GPU_UNAVAILABLE");
    if (!indices.empty()) indices += L',';
    indices += std::to_wstring(index);
    if (end == std::wstring::npos) break;
    first = end + 1;
  } while (first < requested.size());
  if (indices.empty()) throw std::runtime_error("INVALID_GPU_RESERVATION");
  return indices;
}
}
