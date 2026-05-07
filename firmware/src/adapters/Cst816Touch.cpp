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

void Cst816Touch::enqueue(Event ev) {
    const uint8_t next = static_cast<uint8_t>((qTail_ + 1) % kQueueCap);
    if (next == qHead_) return;  // queue full; drop oldest sentinel
    queue_[qTail_] = ev;
    qTail_ = next;
}

application::IInputDevice::Event Cst816Touch::dequeue() {
    if (qHead_ == qTail_) return Event::None;
    const Event ev = queue_[qHead_];
    qHead_ = static_cast<uint8_t>((qHead_ + 1) % kQueueCap);
    return ev;
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
        // Classify: Swipe (vertical travel exceeds threshold), or
        // tap-class (existing logic). Swipe wins over LongPress only
        // if LongPress hasn't fired yet — the lift after a confirmed
        // long-press is silent regardless of finger travel.
        const int dy = lastTouchY_ - touchStartY_;
        const int dx = lastTouchX_ - touchStartX_;
        const int absDy = dy < 0 ? -dy : dy;
        const int absDx = dx < 0 ? -dx : dx;
        const bool isVerticalSwipe =
            !longTouchFired_ &&
            touchStartY_ >= 0 &&
            absDy >= kSwipeMinDy &&
            absDx <= absDy * kSwipeMaxDxOverDy;
        if (longTouchFired_) {
            // already fired LongPress mid-hold; release is a no-op
        } else if (isVerticalSwipe) {
            // Touch coords on this panel: Y grows DOWNWARD, so a
            // finger that moved toward the top of the screen has
            // touchStartY_ > lastTouchY_  → dy < 0  → SwipeUp.
            enqueue(dy < 0 ? Event::SwipeUp : Event::SwipeDown);
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
