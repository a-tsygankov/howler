#include "Cst816Touch.h"

#include <Wire.h>

namespace howler::adapters {

namespace {

constexpr uint8_t I2C_ADDR        = 0x15;
constexpr uint8_t REG_FINGER_NUM  = 0x02;
constexpr uint8_t REG_XPOS_H      = 0x03;

uint8_t readReg(uint8_t reg) {
    Wire.beginTransmission(I2C_ADDR);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return 0;
    if (Wire.requestFrom(static_cast<uint8_t>(I2C_ADDR),
                         static_cast<uint8_t>(1)) != 1) return 0;
    return Wire.read();
}

bool readTouchPos(int& outX, int& outY) {
    Wire.beginTransmission(I2C_ADDR);
    Wire.write(REG_XPOS_H);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(static_cast<uint8_t>(I2C_ADDR),
                         static_cast<uint8_t>(4)) != 4) return false;
    const uint8_t xh = Wire.read();
    const uint8_t xl = Wire.read();
    const uint8_t yh = Wire.read();
    const uint8_t yl = Wire.read();
    outX = (static_cast<int>(xh & 0x0F) << 8) | xl;
    outY = (static_cast<int>(yh & 0x0F) << 8) | yl;
    return true;
}

}  // namespace

void Cst816Touch::begin() {
    pinMode(kPinRst, OUTPUT);
    digitalWrite(kPinRst, LOW);
    delay(20);
    digitalWrite(kPinRst, HIGH);
    delay(50);

    Wire.setPins(kPinSda, kPinScl);
    Wire.begin();
    Wire.setClock(400000);

    pinMode(kPinInt, INPUT_PULLUP);
    Serial.println("[cst816] ready (timing-based gesture detector)");
}

void Cst816Touch::enqueue(Event ev, int magnitude) {
    const uint8_t next = static_cast<uint8_t>((qTail_ + 1) % kQueueCap);
    if (next == qHead_) return;  // queue full; drop oldest sentinel
    queue_[qTail_] = {ev, magnitude};
    qTail_ = next;
}

application::IInputDevice::Event Cst816Touch::dequeue() {
    if (qHead_ == qTail_) return Event::None;
    const auto qe = queue_[qHead_];
    qHead_ = static_cast<uint8_t>((qHead_ + 1) % kQueueCap);
    // Only swipes carry meaningful magnitude — taps / long-press are
    // always magnitude=1. Reset proactively so a stale magnitude can't
    // leak into a non-swipe event read through `lastSwipeMagnitude()`.
    switch (qe.ev) {
        case Event::SwipeUp:
        case Event::SwipeDown:
        case Event::SwipeLeft:
        case Event::SwipeRight:
            lastSwipeMagnitude_ = qe.magnitude;
            break;
        default:
            lastSwipeMagnitude_ = 1;
            break;
    }
    return qe.ev;
}

application::IInputDevice::Event Cst816Touch::poll() {
    // Drain queued events first so callers that loop until None
    // surface every event we synthesised in earlier polls.
    {
        const Event q = dequeue();
        if (q != Event::None) return q;
    }

    const uint32_t now = millis();
    if (now - lastPollMs_ < kPollIntervalMs) return Event::None;
    lastPollMs_ = now;

    const bool touching = readReg(REG_FINGER_NUM) > 0;

    if (touching && !wasTouching_) {
        wasTouching_    = true;
        touchStartMs_   = now;
        longTouchFired_ = false;
        int x = -1, y = -1;
        if (readTouchPos(x, y)) {
            lastTouchX_  = x;
            lastTouchY_  = y;
            touchStartX_ = x;
            touchStartY_ = y;
        }
    } else if (touching && wasTouching_) {
        // Update last-known position so swipe classification at
        // release sees the most recent finger location, not the
        // initial press.
        int x = -1, y = -1;
        if (readTouchPos(x, y)) {
            lastTouchX_ = x;
            lastTouchY_ = y;
        }
        // Held past threshold — fire LongPress eagerly while finger
        // is still down so the UI's arc-fill animation can react.
        if (!longTouchFired_ && (now - touchStartMs_) >= kLongTouchMs) {
            longTouchFired_ = true;
            enqueue(Event::LongPress);
            pendingTap_ = false;
        }
    } else if (!touching && wasTouching_) {
        wasTouching_ = false;
        // Classify: vertical swipe → horizontal swipe → tap-class.
        // Swipe loses to a confirmed LongPress (the user already got
        // their event mid-hold), wins over Tap when on-axis travel
        // exceeds the threshold AND off-axis stays smaller.
        const int dy    = lastTouchY_ - touchStartY_;
        const int dx    = lastTouchX_ - touchStartX_;
        const int absDy = dy < 0 ? -dy : dy;
        const int absDx = dx < 0 ? -dx : dx;
        const bool started =
            !longTouchFired_ && touchStartY_ >= 0 && touchStartX_ >= 0;
        const bool vertical =
            started && absDy >= kSwipeMinDelta &&
            absDx <= absDy * kSwipeMaxOffOverOn;
        const bool horizontal =
            started && absDx >= kSwipeMinDelta &&
            absDy <= absDx * kSwipeMaxOffOverOn;

        // Velocity (px/s along the dominant axis) over the full touch
        // duration. Cheap proxy for instantaneous flick velocity —
        // for the swipes we care about (sub-300 ms gestures from one
        // edge of the disc to the other) the average and peak are
        // close enough that this stays inside ±20 % of a per-sample
        // estimate while costing one division.
        const uint32_t durMs = (touchStartMs_ != 0 && now > touchStartMs_)
            ? (now - touchStartMs_) : 1;
        auto magnitudeFor = [this, durMs](int travelPx) -> int {
            if (travelPx < kSwipeMinDelta) return 1;
            const long velPxPerSec =
                (static_cast<long>(travelPx) * 1000L) /
                static_cast<long>(durMs ? durMs : 1);
            long mag = (velPxPerSec + (kSwipeVelocityPerStep / 2))
                       / kSwipeVelocityPerStep;
            if (mag < 1) mag = 1;
            if (mag > kSwipeMagnitudeCap) mag = kSwipeMagnitudeCap;
            return static_cast<int>(mag);
        };

        if (longTouchFired_) {
            // already fired LongPress mid-hold; release is a no-op
        } else if (vertical) {
            // Touch coords: Y grows DOWNWARD, so a finger that moved
            // toward the top of the screen has dy < 0 → SwipeUp.
            const int mag = magnitudeFor(absDy);
            enqueue(dy < 0 ? Event::SwipeUp : Event::SwipeDown, mag);
            pendingTap_ = false;
        } else if (horizontal) {
            // X grows LEFT-TO-RIGHT. A finger that moved right has
            // dx > 0 → SwipeRight (back / previous in mobile carousel
            // convention); leftward → SwipeLeft (forward / next).
            const int mag = magnitudeFor(absDx);
            enqueue(dx < 0 ? Event::SwipeLeft : Event::SwipeRight, mag);
            pendingTap_ = false;
        } else if (pendingTap_ && (now - lastTapEndMs_) < kDoubleTapMs) {
            enqueue(Event::DoubleTap);
            pendingTap_ = false;
        } else {
            // Short tap — wait briefly to see if a second one arrives.
            pendingTap_   = true;
            lastTapEndMs_ = now;
        }
        // Reset start coords so a stale value doesn't leak into the
        // next gesture if the I²C read at touch-down ever fails.
        touchStartX_ = -1;
        touchStartY_ = -1;
    }

    // Pending single tap that timed out → emit Press.
    if (pendingTap_ && !wasTouching_ &&
        (now - lastTapEndMs_) >= kDoubleTapMs) {
        enqueue(Event::Press);
        pendingTap_ = false;
    }

    return dequeue();
}

}  // namespace howler::adapters
