#pragma once

#include "../application/Ports.h"

#include <Arduino.h>

namespace howler::adapters {

/// Reads the CrowPanel quadrature encoder + tactile push button.
///
/// Pin map (matches `firmware/diagram.json` for Wokwi parity — the
/// same pins are wired on the CrowPanel hardware; if production
/// silkscreen differs, re-derive these and update `diagram.json`
/// in the same commit so HIL-2 stays in sync):
///   - encoder CLK:  GPIO 5
///   - encoder DT:   GPIO 6
///   - encoder SW:   GPIO 7  (active LOW)
///
/// Quadrature decoding uses the cheap "transition table" approach
/// — we sample both pins on every poll, encode prev|curr into 4 bits,
/// look up the transition's direction, and accumulate. One full
/// detent (4 transitions on this encoder) emits one rotation event.
class RotaryInput : public howler::application::IInputDevice {
public:
    static constexpr int kPinA      = 5;
    static constexpr int kPinB      = 6;
    static constexpr int kPinButton = 7;
    static constexpr uint32_t kLongPressMs = 600;

    void begin() {
        pinMode(kPinA, INPUT_PULLUP);
        pinMode(kPinB, INPUT_PULLUP);
        pinMode(kPinButton, INPUT_PULLUP);
        prev_ = readState();
    }

    Event poll() override {
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

private:
    uint8_t prev_ = 0;
    int8_t accumulator_ = 0;
    bool wasPressed_ = false;
    uint32_t pressStartedMs_ = 0;

    static uint8_t readState() {
        return static_cast<uint8_t>(
            (digitalRead(kPinA) << 1) | digitalRead(kPinB));
    }
};

}  // namespace howler::adapters
