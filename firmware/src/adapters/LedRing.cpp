#include "LedRing.h"

#include <Arduino.h>

namespace howler::adapters {

namespace {

// Breathing period in ms — gentle, not distracting.
constexpr uint32_t BREATH_PERIOD_MS = 4000;
// Ambient brightness ranges (0..255). Low max so the ring is a
// peripheral cue, not a beacon — the LCD is the primary.
constexpr uint8_t AMBIENT_MIN_BRIGHT = 4;
constexpr uint8_t AMBIENT_MAX_BRIGHT = 32;

uint8_t scaleChan(uint8_t c, uint8_t bright) {
    return static_cast<uint8_t>((static_cast<uint16_t>(c) * bright) / 255);
}

uint32_t scaleColor(uint32_t color, uint8_t bright) {
    const uint8_t r = (color >> 16) & 0xFF;
    const uint8_t g = (color >> 8)  & 0xFF;
    const uint8_t b =  color        & 0xFF;
    return (uint32_t)scaleChan(r, bright) << 16 |
           (uint32_t)scaleChan(g, bright) <<  8 |
           (uint32_t)scaleChan(b, bright);
}

}  // namespace

void LedRing::begin() {
    pixels_.begin();
    pixels_.setBrightness(255);
    off();
    Serial.println("[led] ready (WS2812 x5 on GPIO 48)");
}

void LedRing::pulse(uint32_t color, uint16_t durationMs) {
    for (uint16_t i = 0; i < LED_COUNT; ++i) {
        pixels_.setPixelColor(i, color);
    }
    pixels_.show();
    pulseEndMs_  = millis() + durationMs;
    pulseActive_ = true;
}

void LedRing::setAmbient(uint32_t color) {
    if (color == ambientColor_) return;  // skip needless re-renders
    ambientColor_ = color;
    if (!pulseActive_) renderAmbientFrame();
}

void LedRing::tick() {
    const uint32_t now = millis();
    if (pulseActive_ && static_cast<int32_t>(now - pulseEndMs_) >= 0) {
        pulseActive_ = false;
        renderAmbientFrame();
        return;
    }
    if (!pulseActive_) {
        // Re-render breathing frame ~30 fps.
        if (now - lastAnimMs_ >= 33) {
            lastAnimMs_ = now;
            renderAmbientFrame();
        }
    }
}

void LedRing::off() {
    pulseActive_  = false;
    ambientColor_ = 0;
    for (uint16_t i = 0; i < LED_COUNT; ++i) {
        pixels_.setPixelColor(i, 0);
    }
    pixels_.show();
}

void LedRing::renderAmbientFrame() {
    if (ambientColor_ == 0) {
        for (uint16_t i = 0; i < LED_COUNT; ++i) pixels_.setPixelColor(i, 0);
        pixels_.show();
        return;
    }
    // Breathing: triangle wave between AMBIENT_MIN_BRIGHT and
    // AMBIENT_MAX_BRIGHT (one cycle per BREATH_PERIOD_MS).
    const uint32_t phase = millis() % BREATH_PERIOD_MS;
    const uint32_t half  = BREATH_PERIOD_MS / 2;
    const uint32_t dist  = phase < half ? phase : (BREATH_PERIOD_MS - phase);
    const uint32_t span  = AMBIENT_MAX_BRIGHT - AMBIENT_MIN_BRIGHT;
    const uint8_t bright = static_cast<uint8_t>(
        AMBIENT_MIN_BRIGHT + (span * dist) / half);
    const uint32_t scaled = scaleColor(ambientColor_, bright);
    for (uint16_t i = 0; i < LED_COUNT; ++i) {
        pixels_.setPixelColor(i, scaled);
    }
    pixels_.show();
}

}  // namespace howler::adapters
