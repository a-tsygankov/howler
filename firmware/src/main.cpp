// Howler firmware — Phase 0 skeleton. Boots the LCD power rail, brings
// up TFT_eSPI, instantiates the application services with their
// adapters, and runs a simple loop. No screens yet — those land in
// Phase 2 once the §11 unified menu component is in place.

#include <Arduino.h>
#include <TFT_eSPI.h>

#include "adapters/ArduinoClock.h"
#include "adapters/NoopNetwork.h"
#include "application/SyncService.h"
#include "domain/OccurrenceList.h"

#ifndef HOWLER_BACKEND_URL
#define HOWLER_BACKEND_URL ""
#endif

// CrowPanel quirk inherited from Feedme: GPIO 1 must be driven HIGH
// to power the LCD's 3.3 V rail before TFT_eSPI is initialised.
static constexpr int LCD_POWER_PIN = 1;

static TFT_eSPI tft;
static howler::adapters::ArduinoClock clock_;
static howler::adapters::NoopNetwork  net_;
static howler::domain::OccurrenceList occList_;
static howler::application::SyncService sync_(net_, clock_, occList_);

void setup() {
    Serial.begin(115200);
    pinMode(LCD_POWER_PIN, OUTPUT);
    digitalWrite(LCD_POWER_PIN, HIGH);
    delay(50);

    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("howler", 120, 110, 4);
    tft.drawString("phase 0", 120, 140, 2);

    Serial.println("[howler] boot ok");
    Serial.print("[howler] backend=");
    Serial.println(strlen(HOWLER_BACKEND_URL) > 0 ? HOWLER_BACKEND_URL : "(none)");
}

void loop() {
    sync_.tick();
    delay(10);
}
