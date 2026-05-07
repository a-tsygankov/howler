#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <stdint.h>

namespace howler::adapters {

/// SoftAP + DNS catch-all + HTTP form for first-boot Wi-Fi setup.
/// Ported in spirit from Feedme's `WifiCaptivePortal` (same hardware,
/// same DNS-trick), simplified to the boot-mode flow only — in-place
/// network switching from Settings is a follow-up.
///
/// Lifecycle:
///   begin(storage)  — bring up AP `howler-XXXX` (last 4 of MAC),
///                     pre-scan visible SSIDs, serve a form on /,
///                     answer any DNS query with our IP so phone OSes
///                     trip their captive-portal probe.
///   handle()        — pump from loop() every tick.
///   isComplete()    — true after a successful form submit; main.cpp
///                     reboots so the next boot enters STA mode with
///                     the saved creds.
///
/// Persists `howler.wifi` to NVS as `[u16 len][ssid][u16 len][secret]`
/// (matches the format App::saveAndConnectWifi already writes), so the
/// existing `App` boot path picks them up on the next launch without
/// further wiring.
class WifiCaptivePortal {
public:
    void begin(application::IStorage& storage);
    void handle();
    void stop();

    bool isComplete() const { return complete_; }
    const char* apName() const { return apName_; }
    const char* apIp()   const { return "192.168.4.1"; }

private:
    application::IStorage* storage_ = nullptr;
    bool complete_ = false;
    char apName_[32] = "howler-?";
};

}  // namespace howler::adapters
