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
#include "adapters/EspRandom.h"
#include "adapters/NoopNetwork.h"
#include "adapters/NvsStorage.h"
#include "adapters/RotaryInput.h"
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

howler::adapters::ArduinoClock arduinoClock;
howler::adapters::EspRandom    espRandom;
howler::adapters::NvsStorage   nvsStorage;
howler::adapters::RotaryInput  rotaryInput;
howler::adapters::WifiStation  wifiStation;

howler::adapters::NoopNetwork  noopNet;
howler::adapters::WifiPairApi  pairApi(HOWLER_BACKEND_URL);
howler::adapters::WifiNetwork  wifiNet(HOWLER_BACKEND_URL, std::string{});

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

    rotaryInput.begin();
    WiFi.mode(WIFI_STA);
    WiFi.begin();  // best-effort reconnect to last-known network

    auto* net = pickNetwork();
    static howler::application::App app(
        *net, pairApi, arduinoClock, espRandom, nvsStorage, rotaryInput,
        wifiStation, deviceIdFromMac());
    static howler::screens::ScreenManager screens(app, rotaryInput);
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
    delay(5);
}
