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
#include <esp_heap_caps.h>
#include <soc/rtc_cntl_reg.h>
#include <soc/soc.h>

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
//
// The 20-s timeout (up from 12 s) accommodates slower home routers
// — some consumer APs take 5-10 s of DHCP + auth before the device
// flips to WL_CONNECTED. Falling through to the captive portal
// after a too-aggressive timeout would leave users in a "but my
// network IS up" frustration loop.
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

    Serial.printf("[wifi] connecting to '%s' (timeout 20s)\n", ssid.c_str());
    WiFi.mode(WIFI_STA);
    // Belt-and-braces: clear any leftover association state before
    // begin(). Without this, a previous run that ended in AP mode
    // (e.g. captive portal that crashed before reboot) can leave
    // the radio in a half-state where the next begin() reports
    // "connect timeout" even though the SSID is fine.
    WiFi.disconnect(true, false);
    delay(100);
    WiFi.begin(ssid.c_str(), pass.c_str());
    const uint32_t deadline = millis() + 20000;
    uint32_t lastBeat = millis();
    while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
        delay(250);
        // Periodic Serial heartbeat so users tailing the log can see
        // the device is still trying. Without this a "stuck for 12 s
        // then reboot" failure mode is indistinguishable from a
        // crash.
        if (millis() - lastBeat > 2000) {
            Serial.printf("[wifi]   …still trying (status=%d, %lus left)\n",
                          WiFi.status(),
                          static_cast<unsigned long>((deadline - millis()) / 1000));
            lastBeat = millis();
        }
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.printf("[wifi] connect timeout (status=%d) - falling back to captive portal\n",
                      WiFi.status());
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
//
// Resilience for the "splash flashes then reboot loop" symptom users
// have reported:
//   - Brownout detector disabled BEFORE bringing up SoftAP. SoftAP +
//     radio scan + HTTP server is the most power-hungry state the
//     device sees; marginal USB supplies cause a voltage transient
//     that trips the brownout reset → reboot. Re-enabled implicitly
//     by ESP.restart() at the end (the BOR setting is reset to
//     fuse defaults on a hard reset).
//   - Heap snapshot at entry, logged to Serial. If the firmware
//     image grew past a memory threshold and the portal is OOM-ing
//     during SoftAP init, this number tells us in the log.
//   - Periodic Serial heartbeat (~5 s) inside the poll loop so users
//     tailing the log can distinguish "portal alive, waiting on you"
//     from "portal crashed silently".
//   - `__builtin_unreachable()` after ESP.restart() so the compiler
//     accepts the `[[noreturn]]` annotation (ESP.restart() isn't
//     declared noreturn upstream).
[[noreturn]] void runCaptivePortalAndReboot() {
    Serial.printf("[setup] heap free at portal entry: %u B\n",
                  static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_DEFAULT)));

    // Mute the brownout detector for the duration of the portal. The
    // BOR register is documented in the ESP32-S3 TRM §7.10; writing 0
    // disables the trigger without affecting the analog comparator
    // itself, so a real brownout still gets logged in the boot reason
    // on the next power cycle.
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

    captivePortal.begin(nvsStorage);
    Serial.printf("[setup] portal active. Connect to '%s' then open http://%s\n",
                  captivePortal.apName(), captivePortal.apIp());

    uint32_t lastBeat = millis();
    while (!captivePortal.isComplete()) {
        captivePortal.handle();
        delay(2);
        if (millis() - lastBeat > 5000) {
            Serial.printf("[setup]   …portal alive, awaiting form submit (heap=%u)\n",
                          static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_DEFAULT)));
            lastBeat = millis();
        }
    }
    Serial.println("[setup] saved - rebooting");
    delay(500);  // let the HTTP "saved" response flush to the phone
    ESP.restart();
    // Marker for the compiler — ESP.restart() upstream doesn't carry
    // a noreturn attribute, so without this the `[[noreturn]]` on the
    // function signature trips a 'noreturn function does return'
    // warning. The CPU actually resets before reaching this line.
    __builtin_unreachable();
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
