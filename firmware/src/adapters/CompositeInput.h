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
            if (e != Event::None) { preferA_ = false; lastWasA_ = true; return e; }
            const Event f = b_.poll();
            if (f != Event::None) { lastWasA_ = false; return f; }
        } else {
            const Event e = b_.poll();
            if (e != Event::None) { preferA_ = true; lastWasA_ = false; return e; }
            const Event f = a_.poll();
            if (f != Event::None) { lastWasA_ = true; return f; }
        }
        return Event::None;
    }

    bool isHeld() const override {
        return a_.isHeld() || b_.isHeld();
    }

    /// Forward to whichever source produced the last event. The
    /// encoder source returns the default (1); the touch source
    /// returns its velocity-derived magnitude. Reading without a
    /// preceding event yields whichever source served the previous
    /// gesture — fine because callers only consult this directly
    /// after a poll() that returned a Swipe event.
    int lastSwipeMagnitude() const override {
        return lastWasA_ ? a_.lastSwipeMagnitude()
                         : b_.lastSwipeMagnitude();
    }

private:
    A& a_;
    B& b_;
    bool preferA_ = true;
    bool lastWasA_ = true;
};

}  // namespace howler::adapters
