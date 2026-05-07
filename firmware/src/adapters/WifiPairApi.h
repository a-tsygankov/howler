#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

namespace howler::adapters {

/// Pair-flow client. Doesn't carry an Authorization header — the
/// /api/pair/start and /check endpoints are unauthenticated by
/// design (the deviceId is the identity until a token is issued).
class WifiPairApi : public howler::application::IPairApi {
public:
    using NetResult = howler::application::NetResult;

    explicit WifiPairApi(const char* backendUrl) : backendUrl_(backendUrl) {}

    NetResult start(const std::string& deviceId,
                    howler::domain::PairState& state) override {
        JsonDocument req;
        req["deviceId"] = deviceId;
        req["hwModel"] = "crowpanel-1.28";
        String body;
        serializeJson(req, body);
        String resp;
        const auto r = doPost("/api/pair/start", body, resp);
        if (!r.isOk()) return r;
        JsonDocument doc;
        if (deserializeJson(doc, resp)) return NetResult::transient();
        state.pairCode = doc["pairCode"] | "";
        state.expiresAt = doc["expiresAt"] | 0;
        if (state.pairCode.empty()) {
            state.phase = howler::domain::PairPhase::Failed;
            state.lastError = "no pairCode in response";
            return NetResult::transient();
        }
        state.phase = howler::domain::PairPhase::Started;
        return r;
    }

    NetResult check(const std::string& deviceId,
                    howler::domain::PairState& state) override {
        JsonDocument req;
        req["deviceId"] = deviceId;
        String body;
        serializeJson(req, body);
        String resp;
        const auto r = doPost("/api/pair/check", body, resp);
        if (!r.isOk()) return r;
        JsonDocument doc;
        if (deserializeJson(doc, resp)) return NetResult::transient();
        const std::string status = doc["status"] | "";
        if (status == "confirmed") {
            state.phase = howler::domain::PairPhase::Confirmed;
            state.deviceToken = doc["deviceToken"] | "";
            return r;
        }
        if (status == "pending") {
            state.phase = howler::domain::PairPhase::Pending;
            state.expiresAt = doc["expiresAt"] | state.expiresAt;
            return r;
        }
        if (status == "expired") state.phase = howler::domain::PairPhase::Expired;
        else if (status == "cancelled") state.phase = howler::domain::PairPhase::Cancelled;
        else state.phase = howler::domain::PairPhase::Failed;
        return r;
    }

private:
    const char* backendUrl_;

    NetResult doPost(const String& path, const String& body, String& respOut) {
        if (!backendUrl_ || !backendUrl_[0]) return NetResult::transient();
        if (WiFi.status() != WL_CONNECTED) return NetResult::transient();
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.setTimeout(8000);
        if (!http.begin(client, String(backendUrl_) + path)) return NetResult::transient();
        http.addHeader("Content-Type", "application/json");
        const int code = http.POST(body);
        respOut = http.getString();
        http.end();
        if (code >= 200 && code < 300) return NetResult::ok(std::string(respOut.c_str()));
        if (code >= 400 && code < 500) return NetResult::permanent(code, std::string(respOut.c_str()));
        return NetResult::transient(code);
    }
};

}  // namespace howler::adapters
