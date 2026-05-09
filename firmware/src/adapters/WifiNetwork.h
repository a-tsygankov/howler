#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

namespace howler::adapters {

/// HTTPS REST client against the Cloudflare Worker. Each call opens
/// a short-lived TLS connection — there's no per-request keepalive,
/// because the device sleeps between syncs and an idle TLS session
/// won't survive a deep-sleep cycle anyway.
///
/// Auth: device token is set after pairing; we send it as
/// `Authorization: Bearer <token>` (matches what the SPA does for
/// user tokens — the server accepts both via authFromHeaders).
class WifiNetwork : public howler::application::INetwork {
public:
    using NetResult = howler::application::NetResult;

    WifiNetwork(const char* backendUrl, std::string deviceToken)
        : backendUrl_(backendUrl), deviceToken_(std::move(deviceToken)) {}

    void setDeviceToken(std::string t) { deviceToken_ = std::move(t); }
    const std::string& deviceToken() const { return deviceToken_; }
    bool hasToken() const { return !deviceToken_.empty(); }

    bool isOnline() const override {
        return WiFi.status() == WL_CONNECTED && hasToken() && backendUrl_ && backendUrl_[0];
    }

    NetResult fetchPending(std::vector<howler::domain::Occurrence>& out) override;
    NetResult fetchDashboard(std::vector<howler::domain::DashboardItem>& out,
                             int64_t& serverNowSec) override;
    NetResult fetchUsers(std::vector<howler::domain::User>& out) override;
    NetResult fetchResultTypes(std::vector<howler::domain::ResultType>& out) override;
    NetResult postMarkDone(const howler::domain::MarkDoneDraft& d) override;
    NetResult postHeartbeat(const std::string& fwVersion) override;
    NetResult fetchIcon(const std::string& name,
                        std::string& outBitmap,
                        std::string& outHash) override;
    NetResult fetchIconManifest(std::vector<std::string>& outNames) override;

private:
    const char* backendUrl_;
    std::string deviceToken_;

    NetResult doGet(const String& path, String& bodyOut);
    NetResult doPost(const String& path, const String& body);
    NetResult fromHttp(int code, const String& body);
};

}  // namespace howler::adapters
