#pragma once

#include "../application/Ports.h"

#include <Arduino.h>
#include <stdint.h>

namespace howler::adapters {

/// CST816D capacitive-touch IC adapter for the CrowPanel 1.28" board.
/// Ported in spirit from Feedme/firmware/src/adapters/Cst816TapSensor
/// (same hardware, same I²C protocol). Howler's IInputDevice abstracts
/// away the source so this driver emits the same Event enum that the
/// rotary encoder produces — touch taps and knob presses become
/// indistinguishable upstream.
///
/// The CST816D's gesture register on this CrowPanel variant always
/// reports 0x0C regardless of touch duration (Feedme footnote), so
/// we ignore the chip's gesture engine and synthesize Press /
/// DoubleTap / LongPress in software by polling finger-count register
/// 0x02 over I²C and timing the touches.
///
/// Pin map (Elecrow wiki — verified empirically against Feedme):
///   SDA = GPIO 6
///   SCL = GPIO 7
///   RST = GPIO 13
///   INT = GPIO 5  (not used by the timing-based path)
///
/// `begin()` MUST be called after rotary input + Wire.begin() — Wire's
/// pin assignment is global so a later begin() would override.
class Cst816Touch : public application::IInputDevice {
public:
    static constexpr int kPinSda = 6;
    static constexpr int kPinScl = 7;
    static constexpr int kPinRst = 13;
    static constexpr int kPinInt = 5;

    static constexpr uint32_t kLongTouchMs   = 1200;
    static constexpr uint32_t kDoubleTapMs   = 300;
    static constexpr uint32_t kPollIntervalMs = 20;  // ~50 Hz

    void begin();

    /// Poll the touch IC. Returns one event per call; subsequent calls
    /// drain a small queue (when a Tap is followed shortly by a
    /// DoubleTap, both events surface).
    Event poll() override;

    bool isTouching() const { return wasTouching_; }
    int  lastTouchX() const { return lastTouchX_; }
    int  lastTouchY() const { return lastTouchY_; }

    bool isHeld() const override { return wasTouching_; }

private:
    void enqueue(Event ev);
    Event dequeue();

    bool      wasTouching_     = false;
    bool      pendingTap_      = false;
    bool      longTouchFired_  = false;
    uint32_t  touchStartMs_    = 0;
    uint32_t  lastTapEndMs_    = 0;
    uint32_t  lastPollMs_      = 0;
    int       lastTouchX_      = -1;
    int       lastTouchY_      = -1;

    // Tiny ring buffer — at most we ever queue Press + DoubleTap
    // back-to-back, so 4 slots is plenty.
    static constexpr size_t kQueueCap = 4;
    Event   queue_[kQueueCap]{};
    uint8_t qHead_ = 0;
    uint8_t qTail_ = 0;
};

}  // namespace howler::adapters
