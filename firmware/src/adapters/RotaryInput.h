#pragma once

#include "../application/Ports.h"

#include <Arduino.h>

namespace howler::adapters {

/// Reads the CrowPanel quadrature encoder + tactile push button.
///
/// Pin map (verified against Feedme's `EncoderButtonSensor.h` for the
/// same hardware AND empirically via `HOWLER_PIN_PROBE` — see commit
/// log). GPIO 5/6/7 in earlier versions were *wrong*: those pins are
/// the CST816 touch panel (INT/SDA/SCL).
///   - encoder A   (CLK):  GPIO 45
///   - encoder B   (DT):   GPIO 42
///   - encoder SW  (knob): GPIO 41  (active LOW, internal pull-up)
///
/// Quadrature decoding uses the cheap "transition table" approach
/// — we sample both pins on every poll, encode prev|curr into 4 bits,
/// look up the transition's direction, and accumulate. One full
/// detent (4 transitions on this encoder) emits one rotation event.
///
/// `HOWLER_DEBUG_INPUT` (set via build flag) prints every event to
/// Serial — useful when you don't trust the pin map yet.
class RotaryInput : public howler::application::IInputDevice {
public:
    static constexpr int kPinA      = 45;
    static constexpr int kPinB      = 42;
    static constexpr int kPinButton = 41;
    static constexpr uint32_t kLongPressMs = 600;

    void begin() {
        pinMode(kPinA, INPUT_PULLUP);
        pinMode(kPinB, INPUT_PULLUP);
        pinMode(kPinButton, INPUT_PULLUP);
        prev_ = readState();
#ifdef HOWLER_DEBUG_INPUT
        Serial.printf("[input] rotary on GPIO A=%d B=%d SW=%d  initial state=%u btn=%d\n",
            kPinA, kPinB, kPinButton, prev_, digitalRead(kPinButton));
#endif
    }

    Event poll() override {
        Event out = pollImpl();
#ifdef HOWLER_DEBUG_INPUT
        if (out != Event::None) {
            const char* name =
                out == Event::RotateCW   ? "RotateCW"   :
                out == Event::RotateCCW  ? "RotateCCW"  :
                out == Event::Press      ? "Press"      :
                out == Event::LongPress  ? "LongPress"  : "?";
            Serial.printf("[input] event=%s  A=%d B=%d SW=%d\n",
                name,
                digitalRead(kPinA),
                digitalRead(kPinB),
                digitalRead(kPinButton));
        }
        // Raw-pin watchdog: print whenever the *raw* state of any
        // input pin changes, even if we didn't classify it as an
        // event. Gives a "did the pin actually move?" answer without
        // staring at logic-analyser output.
        const uint8_t curState = readState();
        const int curBtn = digitalRead(kPinButton);
        if (curState != lastDebugState_ || curBtn != lastDebugBtn_) {
            Serial.printf("[input] raw A=%d B=%d SW=%d  (was A=%d B=%d SW=%d)\n",
                (curState >> 1) & 1, curState & 1, curBtn,
                (lastDebugState_ >> 1) & 1, lastDebugState_ & 1, lastDebugBtn_);
            lastDebugState_ = curState;
            lastDebugBtn_ = curBtn;
        }
#endif
        return out;
    }

private:
    uint8_t prev_ = 0;
    int8_t accumulator_ = 0;
    bool wasPressed_ = false;
    uint32_t pressStartedMs_ = 0;
#ifdef HOWLER_DEBUG_INPUT
    uint8_t lastDebugState_ = 3;
    int     lastDebugBtn_   = 1;
#endif

    Event pollImpl() {
        // 1. Decode rotation.
        const uint8_t curr = readState();
        const uint8_t key = static_cast<uint8_t>((prev_ << 2) | curr);
        // -1, +1, 0 lookup. Two-bit transitions: see app note AN-08
        // for quadrature decoders. Ignore double-transitions (curr==prev
        // or 11→00 / 00→11 which are noise).
        static constexpr int8_t kDelta[16] = {
            0, -1,  1,  0,
            1,  0,  0, -1,
           -1,  0,  0,  1,
            0,  1, -1,  0
        };
        accumulator_ += kDelta[key];
        prev_ = curr;
        if (accumulator_ >= 4) { accumulator_ = 0; return Event::RotateCW; }
        if (accumulator_ <= -4) { accumulator_ = 0; return Event::RotateCCW; }

        // 2. Decode button. Active LOW; long-press if held > kLongPressMs.
        const bool pressed = digitalRead(kPinButton) == LOW;
        const uint32_t now = millis();
        if (pressed && !wasPressed_) {
            wasPressed_ = true;
            pressStartedMs_ = now;
        } else if (!pressed && wasPressed_) {
            wasPressed_ = false;
            const uint32_t held = now - pressStartedMs_;
            return (held >= kLongPressMs) ? Event::LongPress : Event::Press;
        }
        return Event::None;
    }

    static uint8_t readState() {
        return static_cast<uint8_t>(
            (digitalRead(kPinA) << 1) | digitalRead(kPinB));
    }
};

/// One-shot bring-up scan that probes a wide range of GPIOs and prints
/// which ones change while the user wiggles the encoder. Run from
/// main.cpp under `#ifdef HOWLER_PIN_PROBE` for ~6 s on boot, then
/// look at the serial log to derive the right pin map for the
/// hardware in front of you. Production builds leave this off.
///
/// The Arduino main-task WDT bites if we sit in setup() for too long,
/// so we yield with `vTaskDelay` (proper FreeRTOS yield) instead of
/// the bare `delay(2)` that left earlier runs in a TG1WDT_SYS_RST loop.
inline void probeInputPinsBlocking(uint32_t durationMs = 6000) {
    static const int kCandidates[] = {
        // Skip flash/PSRAM pins (26..32 on S3, 19/20 USB) and pins
        // already taken by TFT (3,9,10,11,14,46) or LCD power (1).
        0, 2, 4, 5, 6, 7, 8, 12, 13, 15, 16, 17, 18,
        21, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 45, 47, 48,
    };
    constexpr size_t N = sizeof(kCandidates) / sizeof(kCandidates[0]);
    int prev[N];
    for (size_t i = 0; i < N; ++i) {
        pinMode(kCandidates[i], INPUT_PULLUP);
        prev[i] = digitalRead(kCandidates[i]);
    }
    Serial.println("[probe] wiggle the encoder + press the knob now...");
    const uint32_t deadline = millis() + durationMs;
    while (millis() < deadline) {
        for (size_t i = 0; i < N; ++i) {
            const int v = digitalRead(kCandidates[i]);
            if (v != prev[i]) {
                Serial.printf("[probe] GPIO %d %d -> %d\n",
                    kCandidates[i], prev[i], v);
                prev[i] = v;
            }
        }
        vTaskDelay(2 / portTICK_PERIOD_MS);
    }
    Serial.println("[probe] done");
}

}  // namespace howler::adapters
