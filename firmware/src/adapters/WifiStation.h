#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <WiFi.h>

namespace howler::adapters {

/// Thin wrapper around Arduino's `WiFi` global. Connects in STA mode
/// only — AP mode (provisioning hotspot) is deferred to a later phase
/// once we have HID over BLE working. For now: settings screen lets
/// the user pick from a scan and type a password on the rotary keyboard.
class WifiStation : public howler::application::IWifi {
public:
    bool isConnected() const override {
        return WiFi.status() == WL_CONNECTED;
    }

    std::string currentSsid() const override {
        return std::string(WiFi.SSID().c_str());
    }

    int8_t currentRssi() const override {
        if (WiFi.status() != WL_CONNECTED) return 0;
        return static_cast<int8_t>(WiFi.RSSI());
    }

    std::string currentIp() const override {
        if (WiFi.status() != WL_CONNECTED) return {};
        return std::string(WiFi.localIP().toString().c_str());
    }

    bool scan(std::vector<howler::domain::WifiNetwork>& out) override {
        const int n = WiFi.scanNetworks(false, true);
        if (n < 0) return false;
        out.clear();
        out.reserve(n);
        for (int i = 0; i < n; ++i) {
            howler::domain::WifiNetwork w;
            w.ssid = std::string(WiFi.SSID(i).c_str());
            w.rssi = static_cast<int8_t>(WiFi.RSSI(i));
            w.secured = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
            out.push_back(std::move(w));
        }
        WiFi.scanDelete();
        return true;
    }

    bool connect(const howler::domain::WifiConfig& cfg) override {
        if (cfg.ssid.empty()) return false;
        WiFi.mode(WIFI_STA);
        WiFi.begin(cfg.ssid.c_str(), cfg.secret.c_str());
        // 12 s budget — typical home AP DHCP completes in 3–6 s; the
        // long tail is rare. Caller decides what to do on false.
        const uint32_t deadline = millis() + 12000;
        while (millis() < deadline) {
            if (WiFi.status() == WL_CONNECTED) return true;
            delay(100);
        }
        return false;
    }

    void disconnect() override {
        WiFi.disconnect(true);
    }
};

}  // namespace howler::adapters
