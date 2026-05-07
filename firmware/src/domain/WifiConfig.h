#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace howler::domain {

/// What's persisted in NVS for Wi-Fi (plan §10.4): the SSID we last
/// connected to, plus the secret. The secret is opaque here — the
/// adapter writes it to NVS in plaintext (matches Feedme's simpler
/// flow; no secure-element on this hardware).
struct WifiConfig {
    std::string ssid;
    std::string secret;
};

/// One scan result the Wi-Fi screen renders. Open networks have an
/// empty secret type; signal is RSSI in dBm (closer to 0 = stronger).
struct WifiNetwork {
    std::string ssid;
    int8_t      rssi;
    bool        secured;
};

}  // namespace howler::domain
