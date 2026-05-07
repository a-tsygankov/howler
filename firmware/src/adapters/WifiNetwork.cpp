#include "WifiNetwork.h"

namespace howler::adapters {

namespace {

constexpr unsigned kHttpTimeoutMs = 8000;

howler::domain::Urgency urgencyFromString(const char* s) {
    return (s && std::string(s) == "URGENT")
        ? howler::domain::Urgency::Urgent
        : howler::domain::Urgency::NonUrgent;
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
    auto r = doGet("/api/dashboard", body);
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

}  // namespace howler::adapters
