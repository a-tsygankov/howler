#include "WifiNetwork.h"

#include "../domain/Urgency.h"  // parseDailyTime + ScheduleRule

namespace howler::adapters {

namespace {

constexpr unsigned kHttpTimeoutMs = 8000;

howler::domain::Urgency urgencyFromString(const char* s) {
    if (!s) return howler::domain::Urgency::NonUrgent;
    const std::string v = s;
    if (v == "URGENT")     return howler::domain::Urgency::Urgent;
    if (v == "HIDDEN")     return howler::domain::Urgency::Hidden;
    return howler::domain::Urgency::NonUrgent;
}

}  // namespace

howler::application::NetResult WifiNetwork::fromHttp(int code, const String& body) {
    using NetResult = howler::application::NetResult;
    if (code >= 200 && code < 300) return NetResult::ok(std::string(body.c_str()));
    if (code >= 400 && code < 500) return NetResult::permanent(code, std::string(body.c_str()));
    return NetResult::transient(code);
}

howler::application::NetResult WifiNetwork::doGet(const String& path, String& bodyOut) {
    using NetResult = howler::application::NetResult;
    if (!isOnline()) return NetResult::transient();
    WiFiClientSecure client;
    client.setInsecure();  // Phase 1: no pinning. Plan §10 #3.
    HTTPClient http;
    http.setTimeout(kHttpTimeoutMs);
    String url = String(backendUrl_) + path;
    if (!http.begin(client, url)) return NetResult::transient();
    http.addHeader("Authorization", String("Bearer ") + deviceToken_.c_str());
    const int code = http.GET();
    bodyOut = http.getString();
    http.end();
    return fromHttp(code, bodyOut);
}

howler::application::NetResult WifiNetwork::doPost(const String& path, const String& body) {
    using NetResult = howler::application::NetResult;
    if (!isOnline()) return NetResult::transient();
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(kHttpTimeoutMs);
    String url = String(backendUrl_) + path;
    if (!http.begin(client, url)) return NetResult::transient();
    http.addHeader("Authorization", String("Bearer ") + deviceToken_.c_str());
    http.addHeader("Content-Type", "application/json");
    const int code = http.POST(body);
    String resp = http.getString();
    http.end();
    return fromHttp(code, resp);
}

howler::application::NetResult WifiNetwork::fetchPending(
    std::vector<howler::domain::Occurrence>& out) {
    String body;
    auto r = doGet("/api/occurrences/pending", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body)) return howler::application::NetResult::transient();
    auto arr = doc["occurrences"].as<JsonArrayConst>();
    out.clear();
    out.reserve(arr.size());
    for (auto v : arr) {
        howler::domain::Occurrence o;
        o.id = v["id"] | "";
        o.taskId = howler::domain::TaskId(std::string(v["taskId"] | ""));
        o.title = v["title"] | "";
        o.priority = static_cast<uint8_t>(v["priority"] | 0);
        o.dueAt = v["dueAt"] | static_cast<long long>(-1);
        o.status = howler::domain::OccurrenceStatus::Pending;
        out.push_back(std::move(o));
    }
    return r;
}

howler::application::NetResult WifiNetwork::fetchDashboard(
    std::vector<howler::domain::DashboardItem>& out,
    int64_t& serverNowSec) {
    String body;
    // Always pass `?include=hidden` so the device gets every active
    // task with its urgency tier intact. The SyncService splits the
    // response client-side into `dashboard()` (Urgent + NonUrgent)
    // and `allTasks()` (everything). One HTTP call, two views.
    auto r = doGet("/api/dashboard?include=hidden", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body)) return howler::application::NetResult::transient();
    serverNowSec = doc["now"] | 0;
    auto arr = doc["tasks"].as<JsonArrayConst>();
    out.clear();
    out.reserve(arr.size());
    for (auto v : arr) {
        howler::domain::DashboardItem d;
        const std::string taskHex = v["task"]["id"] | "";
        d.taskId = howler::domain::TaskId(taskHex);
        d.id = taskHex;  // dashboard rows are keyed by task — no occurrence
        d.occurrenceId = "";
        d.title = v["task"]["title"] | "";
        d.avatarId = v["task"]["avatarId"] | "";
        d.resultTypeId = v["task"]["resultTypeId"] | "";
        d.priority = static_cast<uint8_t>(v["task"]["priority"] | 0);
        d.urgency = urgencyFromString(v["urgency"] | "");
        d.dueAt = v["nextDeadline"] | static_cast<long long>(-1);
        d.isMissed = v["isMissed"] | false;
        d.updatedAt = v["task"]["updatedAt"] | 0;

        // Slice B: parse the rule + anchors so the device can
        // recompute urgency locally per frame. The fields are
        // additive — older Worker deploys may omit them, in which
        // case `hasRule` stays false and the screen renderer falls
        // back to the server snapshot above.
        auto ruleNode = v["rule"];
        const std::string ruleKindStr = ruleNode["kind"] | "";
        const int64_t modAt = v["scheduleModifiedAt"]
                                | static_cast<long long>(-1);
        if (!ruleKindStr.empty() && modAt > 0) {
            if (ruleKindStr == "DAILY") {
                d.ruleKind = 0;
                auto times = ruleNode["times"].as<JsonArrayConst>();
                d.dailyMinutes.reserve(times.size());
                for (auto t : times) {
                    const std::string s = t.as<const char*>() ? t.as<const char*>() : "";
                    const int mod = howler::domain::parseDailyTime(s);
                    if (mod >= 0) {
                        d.dailyMinutes.push_back(static_cast<uint16_t>(mod));
                    }
                }
                d.hasRule = !d.dailyMinutes.empty();
            } else if (ruleKindStr == "PERIODIC") {
                d.ruleKind = 1;
                d.intervalDays =
                    static_cast<int32_t>(ruleNode["intervalDays"] | 0);
                d.hasRule = d.intervalDays > 0;
            } else if (ruleKindStr == "ONESHOT") {
                d.ruleKind = 2;
                // Optional cadence; absent ⇒ 0 (no reminders).
                d.intervalDays =
                    static_cast<int32_t>(ruleNode["intervalDays"] | 0);
                d.hasRule = true;
            }
            d.scheduleModifiedAt = modAt;
            d.oneshotDeadline =
                v["oneshotDeadline"] | static_cast<long long>(-1);
            d.lastExecutionAt =
                v["lastExecutionAt"] | static_cast<long long>(-1);
        }

        out.push_back(std::move(d));
    }
    return r;
}

howler::application::NetResult WifiNetwork::fetchUsers(
    std::vector<howler::domain::User>& out) {
    String body;
    auto r = doGet("/api/users", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body)) return howler::application::NetResult::transient();
    auto arr = doc["users"].as<JsonArrayConst>();
    out.clear();
    out.reserve(arr.size());
    for (auto v : arr) {
        howler::domain::User u;
        u.id = v["id"] | "";
        u.displayName = v["displayName"] | "";
        u.login = v["login"] | "";
        u.avatarId = v["avatarId"] | "";
        u.updatedAt = v["updatedAt"] | 0;
        out.push_back(std::move(u));
    }
    return r;
}

howler::application::NetResult WifiNetwork::fetchResultTypes(
    std::vector<howler::domain::ResultType>& out) {
    String body;
    auto r = doGet("/api/task-results", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body)) return howler::application::NetResult::transient();
    auto arr = doc["taskResults"].as<JsonArrayConst>();
    out.clear();
    out.reserve(arr.size());
    for (auto v : arr) {
        howler::domain::ResultType t;
        t.id = v["id"] | "";
        t.displayName = v["displayName"] | "";
        t.unitName = v["unitName"] | "";
        t.hasMin = !v["minValue"].isNull();
        t.hasMax = !v["maxValue"].isNull();
        t.hasDefault = !v["defaultValue"].isNull();
        t.minValue = v["minValue"] | 0.0;
        t.maxValue = v["maxValue"] | 0.0;
        t.step = v["step"] | 1.0;
        t.defaultValue = v["defaultValue"] | 0.0;
        t.useLastValue = v["useLastValue"] | true;
        t.system = v["system"] | false;
        t.updatedAt = v["updatedAt"] | 0;
        out.push_back(std::move(t));
    }
    return r;
}

howler::application::NetResult WifiNetwork::postMarkDone(
    const howler::domain::MarkDoneDraft& d) {
    JsonDocument doc;
    doc["id"] = d.executionId;
    if (!d.userId.empty()) doc["userId"] = d.userId;
    if (d.hasResultValue) doc["resultValue"] = d.resultValue;
    if (!d.notes.empty()) doc["notes"] = d.notes;
    if (d.ts > 0) doc["ts"] = static_cast<long long>(d.ts);
    String body;
    serializeJson(doc, body);

    if (!d.occurrenceId.empty()) {
        return doPost(String("/api/occurrences/") + d.occurrenceId.c_str() + "/ack", body);
    }
    return doPost(String("/api/tasks/") + d.taskId.hex().c_str() + "/complete", body);
}

howler::application::NetResult WifiNetwork::postHeartbeat(const std::string& fwVersion) {
    JsonDocument doc;
    doc["fwVersion"] = fwVersion;
    String body;
    serializeJson(doc, body);
    return doPost("/api/devices/heartbeat", body);
}

howler::application::NetResult WifiNetwork::fetchIcon(
    const std::string& name,
    std::string& outBitmap,
    std::string& outHash) {
    using NetResult = howler::application::NetResult;
    if (!isOnline()) return NetResult::transient();

    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(kHttpTimeoutMs);
    const String url = String(backendUrl_) + "/api/icons/" + name.c_str();
    if (!http.begin(client, url)) return NetResult::transient();
    http.addHeader("Authorization", String("Bearer ") + deviceToken_.c_str());
    // Tell HTTPClient to retain headers we care about so we can read
    // the X-Icon-Hash echo without parsing the full response. The
    // fourth arg is the count of names below.
    static const char* kCollect[] = {"X-Icon-Hash"};
    http.collectHeaders(kCollect, 1);

    const int code = http.GET();
    if (code < 200 || code >= 300) {
        const String body = http.getString();
        http.end();
        return fromHttp(code, body);
    }

    // Pull the raw body into outBitmap. HTTPClient::getString() is
    // safe for binary on Arduino-ESP32 — the underlying String holds
    // arbitrary bytes; we just copy length + data.
    const int contentLen = http.getSize();
    outBitmap.clear();
    if (contentLen > 0) {
        outBitmap.reserve(static_cast<size_t>(contentLen));
    }
    {
        const String body = http.getString();
        outBitmap.assign(body.c_str(), body.length());
    }
    outHash.assign(http.header("X-Icon-Hash").c_str());
    http.end();
    return NetResult::ok();
}

howler::application::NetResult WifiNetwork::fetchIconManifest(
    std::vector<std::string>& outNames) {
    String body;
    auto r = doGet("/api/icons", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body))
        return howler::application::NetResult::transient();
    auto arr = doc["icons"].as<JsonArrayConst>();
    outNames.clear();
    outNames.reserve(arr.size());
    for (auto v : arr) {
        const std::string name = v["name"] | "";
        if (!name.empty()) outNames.push_back(name);
    }
    return r;
}

howler::application::NetResult WifiNetwork::checkFirmwareUpdate(
    const std::string& currentVersion,
    howler::domain::UpdateAdvisory& outAdvisory) {
    // Reset to a clean "no update" answer so a partial parse fails
    // closed: the caller will see updateAvailable=false even if we
    // bail mid-deserialize.
    outAdvisory = {};
    String body;
    String path = "/api/firmware/check?fwVersion=";
    path += currentVersion.c_str();
    auto r = doGet(path, body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body))
        return howler::application::NetResult::transient();
    outAdvisory.updateAvailable = doc["updateAvailable"] | false;
    if (!outAdvisory.updateAvailable) return r;
    outAdvisory.version     = doc["version"] | "";
    outAdvisory.sha256      = doc["sha256"]  | "";
    outAdvisory.sizeBytes   = doc["sizeBytes"] | static_cast<long long>(0);
    outAdvisory.downloadUrl = doc["downloadUrl"] | "";
    outAdvisory.downloadUrlExpiresInSec =
        doc["downloadUrlExpiresInSec"] | 0;
    return r;
}

howler::application::NetResult WifiNetwork::peekHomeCounter(int64_t& outCounter) {
    String body;
    auto r = doGet("/api/homes/peek", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body))
        return howler::application::NetResult::transient();
    // Server returns `{ counter: <int> }`; treat a missing field as
    // a permanent error so SyncService falls through to a full
    // refresh rather than treating "no peek answer" as "unchanged".
    if (!doc["counter"].is<long long>())
        return howler::application::NetResult::permanent(0, "missing counter");
    outCounter = doc["counter"].as<long long>();
    return r;
}

howler::application::NetResult WifiNetwork::fetchHomeIdentity(
    howler::domain::HomeIdentity& outIdentity) {
    // Reset to defaults so a partial parse fails closed (the screen
    // layer renders a fallback when displayName is empty).
    outIdentity = {};
    String body;
    auto r = doGet("/api/homes/me", body);
    if (!r.isOk()) return r;
    JsonDocument doc;
    if (deserializeJson(doc, body))
        return howler::application::NetResult::transient();
    outIdentity.id          = doc["id"]          | "";
    outIdentity.displayName = doc["displayName"] | "";
    outIdentity.avatarId    = doc["avatarId"]    | "";
    outIdentity.tz          = doc["tz"]          | "";
    return r;
}

}  // namespace howler::adapters
