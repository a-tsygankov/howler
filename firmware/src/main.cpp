// Howler firmware entry point. Brings up the LCD power rail, drives
// TFT_eSPI through LVGL via the ScreenManager, and instantiates the
// application services with their concrete adapters.
//
// Provisioning flow:
//   1. boot
//   2. NvsStorage opens "howler.token" — present? → Dashboard.
//      absent? → Pair (PairCoordinator::start runs)
//   3. user confirms on the SPA, /pair/check returns the deviceToken.
//   4. App writes the token to NVS, replaceRoot(Dashboard).
// On subsequent boots step 2 short-circuits.

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <WiFi.h>

#include "adapters/ArduinoClock.h"
#include "adapters/CompositeInput.h"
#include "adapters/Cst816Touch.h"
#include "adapters/EspOtaAdapter.h"
#include "adapters/EspRandom.h"
#include "adapters/LedRing.h"
#include "adapters/NoopNetwork.h"
#include "adapters/NvsStorage.h"
#include "adapters/RotaryInput.h"
#include "adapters/WifiCaptivePortal.h"
#include "adapters/WifiNetwork.h"
#include "adapters/WifiPairApi.h"
#include "adapters/WifiStation.h"
#include "application/App.h"
#include "screens/ScreenManager.h"

#ifndef HOWLER_BACKEND_URL
#define HOWLER_BACKEND_URL ""
#endif

namespace {

// CrowPanel quirk inherited from Feedme: GPIO 1 must be driven HIGH
// to power the LCD's 3.3 V rail before TFT_eSPI is initialised.
constexpr int LCD_POWER_PIN = 1;

TFT_eSPI tft;

howler::adapters::ArduinoClock        arduinoClock;
howler::adapters::EspRandom           espRandom;
howler::adapters::NvsStorage          nvsStorage;
howler::adapters::RotaryInput         rotaryInput;
howler::adapters::Cst816Touch         touchInput;
howler::adapters::CompositeInput<
    howler::adapters::RotaryInput,
    howler::adapters::Cst816Touch>    compositeInput(rotaryInput, touchInput);
howler::adapters::WifiStation         wifiStation;
howler::adapters::LedRing             ledRing;
howler::adapters::WifiCaptivePortal   captivePortal;
howler::adapters::EspOtaAdapter       espOta;

howler::adapters::NoopNetwork  noopNet;
howler::adapters::WifiPairApi  pairApi(HOWLER_BACKEND_URL);
howler::adapters::WifiNetwork  wifiNet(HOWLER_BACKEND_URL, std::string{});

// Read the persisted Wi-Fi creds (App::saveAndConnectWifi format)
// and connect synchronously. Returns true on association.
bool tryConnectFromNvs() {
    std::string blob;
    if (!nvsStorage.readBlob("howler.wifi", blob) || blob.size() < 4) return false;
    auto readStr = [&](size_t& off, std::string& out) -> bool {
        if (off + 2 > blob.size()) return false;
        const uint16_t n =
            static_cast<uint8_t>(blob[off]) |
            (static_cast<uint8_t>(blob[off + 1]) << 8);
        off += 2;
        if (off + n > blob.size()) return false;
        out.assign(blob.data() + off, n);
        off += n;
        return true;
    };
    size_t off = 0;
    std::string ssid, pass;
    if (!readStr(off, ssid) || !readStr(off, pass) || ssid.empty()) return false;

    Serial.printf("[wifi] connecting to '%s'\n", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    const uint32_t deadline = millis() + 12000;
    while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
        delay(250);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[wifi] connect timeout - continuing offline");
        return false;
    }
    Serial.printf("[wifi] connected, ip=%s rssi=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    // Best-effort SNTP. UTC; ts in occurrences are seconds since epoch.
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    return true;
}

// Run the captive portal until the user submits the form, then reboot
// so the next boot enters STA mode with the saved creds.
[[noreturn]] void runCaptivePortalAndReboot() {
    captivePortal.begin(nvsStorage);
    Serial.printf("[setup] portal active. Connect to '%s' then open http://%s\n",
                  captivePortal.apName(), captivePortal.apIp());
    while (!captivePortal.isComplete()) {
        captivePortal.handle();
        delay(2);
    }
    Serial.println("[setup] saved - rebooting");
    delay(500);  // let the HTTP "saved" response flush to the phone
    ESP.restart();
}

// Read the persisted token (if any) and use the wifi-backed network
// when present; otherwise fall back to the noop adapter so the UI is
// exercisable offline.
howler::application::INetwork* pickNetwork() {
    std::string tok;
    if (nvsStorage.readBlob(howler::application::PairCoordinator::kTokenKey, tok)
        && !tok.empty()) {
        wifiNet.setDeviceToken(std::move(tok));
        return &wifiNet;
    }
    return &noopNet;
}

std::string deviceIdFromMac() {
    uint8_t mac[6] = {0};
    WiFi.macAddress(mac);
    static const char hex[] = "0123456789abcdef";
    std::string id;
    id.resize(32);
    // Render the 6-byte MAC into a 32-hex by zero-padding the high
    // 20 bytes — keeps the wire format stable (the server expects
    // a 32-hex deviceId via PairStartSchema).
    for (size_t i = 0; i < 20; ++i) id[i] = '0';
    for (size_t i = 0; i < 6; ++i) {
        id[20 + i * 2 + 0] = hex[(mac[i] >> 4) & 0xF];
        id[20 + i * 2 + 1] = hex[mac[i] & 0xF];
    }
    return id;
}

howler::application::App* g_app = nullptr;
howler::screens::ScreenManager* g_screens = nullptr;

}  // namespace

void setup() {
    Serial.begin(115200);
    pinMode(LCD_POWER_PIN, OUTPUT);
    digitalWrite(LCD_POWER_PIN, HIGH);
    delay(50);

    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);

#ifdef HOWLER_PIN_PROBE
    // Bring-up aid: prints every GPIO that changes state for 6 s.
    // Wiggle the encoder + press the knob during the window — the
    // pins that print are the ones to feed into RotaryInput.h.
    howler::adapters::probeInputPinsBlocking();
#endif

    rotaryInput.begin();
    touchInput.begin();

    // Wi-Fi boot decision. NVS creds → STA + connect. Missing →
    // captive-portal AP `howler-XXXX` for first-boot setup; never
    // returns (reboots once the user submits the web form). Without
    // this the device hits the chicken-and-egg of the SPA needing
    // the device's pair code while the device needs Wi-Fi to fetch
    // a code in the first place.
    if (!tryConnectFromNvs()) {
        // Show the AP name on the raw TFT (LVGL isn't up yet — its
        // bring-up depends on having `g_app` constructed, which we
        // skip when the portal takes over).
        uint8_t mac[6]; WiFi.macAddress(mac);
        char ap[16]; snprintf(ap, sizeof(ap), "howler-%02x%02x", mac[4], mac[5]);
        tft.fillScreen(TFT_BLACK);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.setTextDatum(MC_DATUM);
        tft.drawString("Wi-Fi setup", 120, 90, 4);
        tft.drawString("join", 120, 120, 2);
        tft.drawString(ap, 120, 140, 4);
        tft.drawString("from your phone", 120, 170, 2);
        runCaptivePortalAndReboot();   // never returns
    }

    // LED ring init AFTER Wi-Fi has settled — Adafruit_NeoPixel's
    // RMT bus init can be touchy if it shares timing with the radio
    // bring-up. The ring is dim and steady so a few hundred ms of
    // late start is invisible to the user.
    ledRing.begin();

    auto* net = pickNetwork();
    static howler::application::App app(
        *net, pairApi, arduinoClock, espRandom, nvsStorage, compositeInput,
        wifiStation, ledRing, espOta, deviceIdFromMac());
    static howler::screens::ScreenManager screens(app, compositeInput);
    g_app = &app;
    g_screens = &screens;

    app.begin();
    screens.begin(tft);

    Serial.println("[howler] boot ok");
    Serial.print("[howler] backend=");
    Serial.println(strlen(HOWLER_BACKEND_URL) > 0 ? HOWLER_BACKEND_URL : "(none)");
    Serial.print("[howler] device=");
    Serial.println(app.deviceId().c_str());
}

void loop() {
    const uint32_t now = millis();
    if (g_app)     g_app->tick(now);
    if (g_screens) g_screens->tick(now);

#ifdef HOWLER_DEBUG_INPUT
    // 1 Hz "alive" heartbeat so a frozen UI is distinguishable from
    // a stalled main loop in the serial log.
    static uint32_t lastBeatMs = 0;
    if (now - lastBeatMs > 1000) {
        Serial.printf("[loop] alive ms=%lu\n", (unsigned long)now);
        lastBeatMs = now;
    }
#endif

    delay(5);
}
