#include "WifiCaptivePortal.h"

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include <cstring>
#include <vector>

namespace howler::adapters {

namespace {

constexpr int DNS_PORT = 53;
constexpr int HTTP_PORT = 80;

// Globals because WebServer's lambda registration takes plain function
// pointers — adequate while only one portal exists at a time.
DNSServer        gDns;
WebServer        gHttp(HTTP_PORT);
std::vector<String> gScannedSsids;
volatile bool    gComplete = false;
String           gPendingSsid;
String           gPendingPass;

const char kFormHtml[] PROGMEM = R"HTML(<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Howler setup</title>
<style>
body{font:16px system-ui;margin:0;padding:24px;background:#1A1409;color:#F6EFDC;}
h1{color:#C13D1E;font-weight:400;font-size:22px;margin:0 0 18px;}
label{display:block;margin:14px 0 4px;font-size:13px;color:#A8A099;text-transform:uppercase;letter-spacing:.08em;}
input,select{width:100%;padding:12px;border:1px solid #2E2A20;background:#0E0905;color:#F6EFDC;border-radius:6px;font-size:16px;box-sizing:border-box;}
button{margin-top:24px;width:100%;padding:14px;border:0;background:#C13D1E;color:#F6EFDC;font-size:16px;font-weight:600;border-radius:6px;cursor:pointer;}
.hint{font-size:12px;color:#A8A099;margin-top:14px;padding:12px;background:#0E0905;border:1px solid #2E2A20;border-radius:6px;line-height:1.4;}
.sub{font-size:12px;color:#A8A099;margin-top:4px;}
</style></head><body>
<h1>Howler setup</h1>
<form method="POST" action="/save">
<label>Wi-Fi network</label>
<select name="ssid_pick">
<option value="">-- pick a visible network --</option>
{SSID_OPTIONS}
</select>
<label>Or type SSID</label>
<input type="text" name="ssid_text" placeholder="hidden / not in the list" autocapitalize="none" autocorrect="off">
<div class="sub">Free text wins over the dropdown if both are filled.</div>
<label>Password</label>
<input type="password" name="pass" autocomplete="off">
<div class="hint">After Save, the device reboots and shows a 6-digit pairing code.
Open the Howler web app and enter the code on the dashboard.</div>
<button type="submit">Save and connect</button>
</form>
</body></html>)HTML";

const char kDoneHtml[] PROGMEM = R"HTML(<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved</title>
<style>body{font:16px system-ui;margin:0;padding:48px;background:#1A1409;color:#F6EFDC;text-align:center;}
h1{color:#C13D1E;font-weight:400;}</style>
</head><body>
<h1>Saved</h1>
<p>The device is rebooting. You can disconnect from this Wi-Fi.</p>
</body></html>)HTML";

String buildSsidOptions() {
    // Always returns the visible networks as <option>s. The form
    // template wraps these in a <select> with a leading "pick one"
    // placeholder so the user can also leave it blank and use the
    // free-text field below for hidden SSIDs.
    if (gScannedSsids.empty()) {
        return "<option value=\"\" disabled>(no networks found)</option>";
    }
    String options;
    for (const auto& s : gScannedSsids) {
        options += "<option value=\"" + s + "\">" + s + "</option>";
    }
    return options;
}

void serveForm() {
    String body = kFormHtml;
    body.replace("{SSID_OPTIONS}", buildSsidOptions());
    gHttp.send(200, "text/html", body);
}

void handleSave() {
    // Free-text wins so hidden SSIDs work even if a stale dropdown
    // value sneaks in. Trim leading/trailing whitespace because phone
    // keyboards love appending a space after the auto-suggest pop.
    String text = gHttp.arg("ssid_text");
    text.trim();
    String pick = gHttp.arg("ssid_pick");
    pick.trim();
    gPendingSsid = text.length() > 0 ? text : pick;
    gPendingPass = gHttp.arg("pass");
    if (gPendingSsid.isEmpty()) {
        gHttp.send(400, "text/plain", "ssid required (pick or type)");
        return;
    }
    String body = kDoneHtml;
    gHttp.send(200, "text/html", body);
    gComplete = true;
}

void handleNotFound() {
    // Captive-portal redirect. Most phone OSes hit a known probe URL;
    // any 200 with the form (or a 302 to it) satisfies "is this an
    // open network?" and triggers the sign-in browser. Easiest reliable
    // approach: serve the form for any unknown path.
    serveForm();
}

}  // namespace

void WifiCaptivePortal::begin(application::IStorage& storage) {
    storage_ = &storage;

    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(apName_, sizeof(apName_), "howler-%02x%02x", mac[4], mac[5]);

    Serial.printf("[setup] starting captive portal SSID='%s'\n", apName_);

    // Scan first while still in pure STA — scans take ~3 s but happen
    // once at portal start; results cache for the whole session.
    //
    // The scan needs the radio in a clean state. If anything left
    // Wi-Fi in AP mode (or with a half-failed STA association) the
    // scan returns 0 networks even when several are in range — that
    // matches the "(no networks found)" symptom seen in the wild.
    // Force STA + disconnect + brief settle, then `show_hidden=true`
    // so we surface APs broadcasting nothing.
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(true, true);  // wifioff=true, eraseap=true
    delay(150);
    const int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/true);
    gScannedSsids.clear();
    for (int i = 0; i < n; ++i) {
        const String s = WiFi.SSID(i);
        if (s.length() == 0) continue;  // skip the unnamed hidden APs
        gScannedSsids.push_back(s);
    }
    Serial.printf("[setup] scanned %d networks (kept %u with names)\n",
                  n, (unsigned)gScannedSsids.size());

    // Open SoftAP — no creds needed to join the setup AP itself; the
    // form captures the real creds.
    WiFi.mode(WIFI_AP);
    WiFi.softAP(apName_);
    delay(100);
    const IPAddress ip = WiFi.softAPIP();
    Serial.printf("[setup] AP up, ip=%s\n", ip.toString().c_str());

    gDns.start(DNS_PORT, "*", ip);

    gHttp.on("/", HTTP_GET, serveForm);
    gHttp.on("/save", HTTP_POST, handleSave);
    gHttp.onNotFound(handleNotFound);
    gHttp.begin();

    gComplete = false;
}

void WifiCaptivePortal::handle() {
    gDns.processNextRequest();
    gHttp.handleClient();

    if (gComplete && !complete_) {
        complete_ = true;
        if (storage_) {
            // Match App::saveAndConnectWifi's blob format so the
            // normal-boot path can read it back.
            std::string blob;
            auto putStr = [&](const String& s) {
                const uint16_t n = static_cast<uint16_t>(s.length() & 0xFFFF);
                blob.push_back(static_cast<char>(n & 0xFF));
                blob.push_back(static_cast<char>((n >> 8) & 0xFF));
                blob.append(s.c_str(), s.length());
            };
            putStr(gPendingSsid);
            putStr(gPendingPass);
            storage_->writeBlob("howler.wifi", blob);
            Serial.printf("[setup] saved wifi creds for ssid='%s'\n",
                          gPendingSsid.c_str());
        }
    }
}

void WifiCaptivePortal::stop() {
    Serial.println("[setup] portal stopping");
    gHttp.stop();
    gDns.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
    complete_ = false;
}

}  // namespace howler::adapters
