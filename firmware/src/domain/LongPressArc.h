#pragma once

#include <cstdint>

namespace howler::domain {

/// Drives the "hold-to-confirm" arc that fills as the user holds the
/// knob (or screen) down past a threshold. The screen tick'er calls
/// `update(nowMs, isHeld)` every frame; the model exposes
/// `progress()` (0..1) for the arc widget.
///
/// Three phases:
///   Idle           — nothing held
///   Charging       — finger / knob is down; progress climbing
///   Fired          — progress hit 1.0; UI flashes a confirmation
///                    (the upstream LongPress event is queued by the
///                    input adapter at the same instant).
///
/// Releasing before completion drops back to Idle and the arc rewinds
/// to 0. The "rewind" is purely cosmetic — the actual
/// "did long-press fire" question is answered by the input adapter's
/// `LongPress` event; this class just paints the visual.
class LongPressArc {
public:
    enum class Phase : uint8_t { Idle, Charging, Fired };

    explicit LongPressArc(uint32_t holdMs = 600) : holdMs_(holdMs) {}

    void setHoldMs(uint32_t ms) { holdMs_ = ms; }

    void update(uint32_t nowMs, bool isHeld) {
        if (isHeld) {
            if (phase_ == Phase::Idle) {
                phase_ = Phase::Charging;
                heldFromMs_ = nowMs;
            }
            const uint32_t elapsed = nowMs - heldFromMs_;
            if (elapsed >= holdMs_) {
                progress_ = 1.0f;
                phase_ = Phase::Fired;
            } else {
                progress_ = static_cast<float>(elapsed) / static_cast<float>(holdMs_);
            }
        } else {
            // Release. Snap back to idle; the arc widget can animate
            // its own ease-out if it wants.
            phase_ = Phase::Idle;
            progress_ = 0.0f;
            heldFromMs_ = 0;
        }
    }

    /// 0.0..1.0 fill fraction.
    float progress() const { return progress_; }
    Phase phase() const { return phase_; }

private:
    uint32_t holdMs_;
    uint32_t heldFromMs_ = 0;
    float    progress_ = 0.0f;
    Phase    phase_ = Phase::Idle;
};

}  // namespace howler::domain
