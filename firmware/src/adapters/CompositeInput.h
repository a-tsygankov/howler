#pragma once

#include "../application/Ports.h"

namespace howler::adapters {

/// Merges two IInputDevice sources into one. The encoder produces
/// rotation + Press / DoubleTap / LongPress events; the CST816 touch
/// IC produces tap / DoubleTap / LongPress (no rotation today, but
/// swipe-to-rotate would land here in the future).
///
/// Round-robin polling means events from both sources interleave
/// naturally — no source can starve the other. Each `poll()` returns
/// at most one event; consumers loop until None to drain.
template <typename A, typename B>
class CompositeInput : public application::IInputDevice {
public:
    CompositeInput(A& a, B& b) : a_(a), b_(b) {}

    Event poll() override {
        // Alternate which source we ask first so a chatty source can't
        // monopolize the queue.
        if (preferA_) {
            const Event e = a_.poll();
            if (e != Event::None) { preferA_ = false; return e; }
            const Event f = b_.poll();
            if (f != Event::None) return f;
        } else {
            const Event e = b_.poll();
            if (e != Event::None) { preferA_ = true; return e; }
            const Event f = a_.poll();
            if (f != Event::None) return f;
        }
        return Event::None;
    }

    bool isHeld() const override {
        return a_.isHeld() || b_.isHeld();
    }

private:
    A& a_;
    B& b_;
    bool preferA_ = true;
};

}  // namespace howler::adapters
