#pragma once

// DrumScroller — a vertical "rotating drum" carousel of items. The
// selected item sits in the centre at full size; up to 2 items above
// and 2 below render at progressively smaller scale, simulating a
// drum that's been rotated so its faces are angling away from the
// viewer. Off-screen items don't render.
//
// The widget is fully parametrised: the caller supplies a render
// callback that fills a slot's lv_obj_t with whatever content suits
// the screen — text labels for menus (Settings, Wi-Fi, UserPicker)
// or task cards for dashboards. The component's job is owning the
// 5 slot containers, positioning them on the disc, animating
// transitions between cursor positions, and propagating activate /
// scroll events back up.
//
// Inertial scrolling: scrollBy(direction, magnitude) moves the
// cursor by direction*magnitude items and plays a single ease-out
// slide animation whose duration scales with the magnitude. Fast
// flicks (mag 4–5) take ~600 ms to settle; slow nudges (mag 1) snap
// in ~220 ms. The whole drum is translated vertically rather than
// per-item interpolated, which keeps render cheap on the ESP32 (one
// y-anim, the rebuild happens once at the start of the animation).
//
// Tap on the centre slot fires the on-activate callback. The
// component flags itself clickable so LVGL routes encoder presses
// through; touch dispatch is owned by the screen layer (which
// forwards via fireActivate()).

#include "RoundCard.h"

#include <Arduino.h>
#include <functional>
#include <lvgl.h>
#include <stdint.h>

namespace howler::screens::components {

class DrumScroller {
public:
    /// Render callback signature. `slot` is a fresh lv_obj_t the caller
    /// fills with their tier-specific content. `tier` is in [-2, +2]
    /// where 0 is the centre / selected item; ±1 are the immediate
    /// neighbours; ±2 are the far edges (typically tiny / faded).
    /// `index` is the wrapped item index the slot represents.
    using RenderFn = std::function<void(lv_obj_t* slot,
                                        size_t index,
                                        int tier)>;

    using ActivateFn = std::function<void(size_t index)>;

    /// Build under `parent`, sizing the drum to fill the viewport.
    /// `viewWidth` × `viewHeight` is the bounding box; `tierSpacing`
    /// is how many pixels separate consecutive tiers (centre →
    /// neighbour → far). The default 56 px makes the centre card
    /// (≈ tier 0) and the mini neighbour pills (≈ tier ±1) sit cleanly
    /// in the round display without overlapping the tab strip or the
    /// footer hint.
    void build(lv_obj_t* parent, int viewWidth, int viewHeight,
               int tierSpacing = 56) {
        parent_       = parent;
        tierSpacing_  = tierSpacing;
        // The "container" is a transparent rectangle we translate
        // during scroll animations. Slots live inside; their static
        // y is `tier * tierSpacing` so a container y of 0 means the
        // selected item sits dead centre on the disc.
        container_ = lv_obj_create(parent);
        lv_obj_set_size(container_, viewWidth, viewHeight);
        lv_obj_align(container_, LV_ALIGN_CENTER, 0, 0);
        lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_opa(container_, LV_OPA_0, 0);
        lv_obj_set_style_border_width(container_, 0, 0);
        lv_obj_set_style_pad_all(container_, 0, 0);

        for (int i = 0; i < kVisibleTiers; ++i) {
            slots_[i] = lv_obj_create(container_);
            const int tier = i - kCentreSlot;
            lv_obj_set_size(slots_[i], viewWidth, tierSpacing_);
            lv_obj_align(slots_[i], LV_ALIGN_CENTER, 0, tier * tierSpacing_);
            lv_obj_clear_flag(slots_[i], LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_set_style_bg_opa(slots_[i], LV_OPA_0, 0);
            lv_obj_set_style_border_width(slots_[i], 0, 0);
            lv_obj_set_style_pad_all(slots_[i], 0, 0);
        }
        // Centre slot owns the tap target. We forward tap → onActivate
        // when the screen layer calls fireActivate(); LVGL also fires
        // its own CLICKED event via the encoder press if the slot is
        // in the focus group, but the round-display screens dispatch
        // taps explicitly so this flag mostly matters for hit-testing
        // visual feedback.
        if (slots_[kCentreSlot]) {
            lv_obj_add_flag(slots_[kCentreSlot], LV_OBJ_FLAG_CLICKABLE);
            lv_obj_add_event_cb(slots_[kCentreSlot],
                [](lv_event_t* e) {
                    if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
                    auto* self = static_cast<DrumScroller*>(
                        lv_event_get_user_data(e));
                    if (self) self->fireActivate();
                }, LV_EVENT_CLICKED, this);
        }
    }

    void setRender(RenderFn fn)  { render_ = std::move(fn); rebuild(); }
    void setOnActivate(ActivateFn fn) { onActivate_ = std::move(fn); }

    void setItemCount(size_t n) {
        itemCount_ = n;
        if (cursor_ >= n) cursor_ = n ? n - 1 : 0;
    }

    void setCursor(size_t c) {
        cursor_ = (itemCount_ == 0) ? 0
                : ((c % itemCount_ + itemCount_) % itemCount_);
        rebuild();
    }

    size_t cursor() const { return cursor_; }
    size_t itemCount() const { return itemCount_; }

    /// Move the cursor by direction * magnitude items and play an
    /// inertial slide. `direction` is +1 (toward higher indices) or -1
    /// (toward lower); `magnitude` scales how many items the cursor
    /// jumps and how long the slide takes.
    ///
    /// Wraps around modulo itemCount_ — same convention as the
    /// underlying domain models, so callers that translate this back
    /// into model.moveCursor see consistent behaviour.
    void scrollBy(int direction, int magnitude = 1) {
        if (itemCount_ == 0 || direction == 0) return;
        const int steps = direction * (magnitude < 1 ? 1 : magnitude);
        const size_t n = itemCount_;
        long c = static_cast<long>(cursor_) + steps;
        c = ((c % static_cast<long>(n)) + static_cast<long>(n))
            % static_cast<long>(n);
        cursor_ = static_cast<size_t>(c);

        // Render at the NEW cursor first, then visually slide the
        // whole container from "where it would have been before this
        // scroll" back to 0. From the user's POV this looks like the
        // old neighbours sliding past the centre into their new tiers
        // and the far-edge items appearing from the rim.
        rebuild();

        const int slideFrom = steps * tierSpacing_;
        const int absSteps  = steps < 0 ? -steps : steps;
        const int duration  = kBaseAnimMs + absSteps * kPerStepAnimMs;
        animateContainerY(slideFrom, 0, duration);
    }

    /// Re-render all visible slots at the current cursor. No animation.
    /// Cheap; LVGL handles the actual draw on the next frame.
    void rebuild() {
        if (!container_ || !render_) return;
        // Wipe each slot's children before re-rendering so callers
        // don't have to track widget lifetimes themselves.
        for (int i = 0; i < kVisibleTiers; ++i) {
            if (!slots_[i]) continue;
            lv_obj_clean(slots_[i]);
            const int tier = i - kCentreSlot;
            // Aliasing-aware tier suppression. With n items, the
            // modulo-wrap means tier ±k aliases tier ∓(n-k) — e.g.
            // n=4, tier-2 wraps to the same index as tier+2; n=3,
            // tier-2 aliases tier+1. Rendering the same item at two
            // tiers looks broken (the user sees one row "echoing"
            // the other), so we hide far slots until the list is
            // long enough that no two visible tiers collide. The
            // boundary: tier ±2 is safe iff n ≥ 5; tier ±1 is safe
            // iff n ≥ 3 (n=2 shows the only other item on both
            // sides — accept that, the drum still rotates cleanly).
            if (itemCount_ == 0) continue;
            if (itemCount_ == 1 && tier != 0) continue;
            if (itemCount_ < 5  && (tier == -2 || tier == 2)) continue;
            const long n   = static_cast<long>(itemCount_);
            const long idx = ((static_cast<long>(cursor_) + tier) % n + n) % n;
            render_(slots_[i], static_cast<size_t>(idx), tier);
        }
    }

    /// External activate trigger — used by screen managers that route
    /// tap events through their own dispatch (encoder-press → onEvent
    /// → fireActivate) rather than relying on LVGL's CLICKED.
    void fireActivate() {
        if (itemCount_ == 0 || !onActivate_) return;
        onActivate_(cursor_);
    }

    lv_obj_t* container() const { return container_; }
    lv_obj_t* centreSlot() const {
        return container_ ? slots_[kCentreSlot] : nullptr;
    }

    // ── Tier styling helpers ─────────────────────────────────────
    // Convenience picks for callers building label-style content.
    // Centralised here so the "drum face angles away" font-shrink
    // ramp stays consistent across menu-flavoured screens.
    static const lv_font_t* fontForTier(int tier) {
        switch (tier) {
            case 0:           return &lv_font_montserrat_22;
            case 1: case -1:  return &lv_font_montserrat_18;
            default:          return &lv_font_montserrat_14;
        }
    }
    /// Text colour fade from full-ink at centre to ink3 at the rim.
    static lv_color_t colorForTier(int tier) {
        switch (tier) {
            case 0:           return Palette::ink();
            case 1: case -1:  return Palette::ink2();
            default:          return Palette::ink3();
        }
    }
    /// Default opacity ramp so far-tier items visually "tilt away".
    static lv_opa_t opacityForTier(int tier) {
        switch (tier) {
            case 0:           return LV_OPA_COVER;
            case 1: case -1:  return LV_OPA_80;
            default:          return LV_OPA_40;
        }
    }

private:
    /// Number of slots we keep alive. 5 = centre + 2 above + 2 below.
    /// Increasing this would need matching `tierSpacing_` math + a
    /// taller container — not currently worth it for the 240×240 disc.
    static constexpr int kVisibleTiers = 5;
    static constexpr int kCentreSlot   = 2;  // index in `slots_[]`

    // Animation tuning. Base = ~one frame's settle time on a 50 Hz
    // poll loop; per-step is small so even a magnitude-5 flick stays
    // under ~700 ms (otherwise the user feels lag, not inertia).
    static constexpr int kBaseAnimMs    = 180;
    static constexpr int kPerStepAnimMs = 70;

    void animateContainerY(int from, int to, int durationMs) {
        if (!container_) return;
        // Cancel any in-flight slide so back-to-back swipes don't
        // queue up a stack of animations fighting for the y position.
        lv_anim_delete(container_, nullptr);
        lv_obj_set_y(container_, from);

        lv_anim_t a;
        lv_anim_init(&a);
        lv_anim_set_var(&a, container_);
        lv_anim_set_values(&a, from, to);
        lv_anim_set_time(&a, durationMs);
        lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
        lv_anim_set_exec_cb(&a, [](void* var, int32_t v) {
            lv_obj_set_y(static_cast<lv_obj_t*>(var), v);
        });
        lv_anim_start(&a);
    }

    lv_obj_t*  parent_      = nullptr;
    lv_obj_t*  container_   = nullptr;
    lv_obj_t*  slots_[kVisibleTiers] = {};
    int        tierSpacing_ = 56;
    size_t     itemCount_   = 0;
    size_t     cursor_      = 0;
    RenderFn   render_;
    ActivateFn onActivate_;
};

/// Render a "# - - - -" cursor-dots strip for the given (size, cursor)
/// pair. Used by drum-scrolling screens (Dashboard, TaskList) to give
/// the user a static "where am I in the list" indicator that updates
/// in lockstep with the drum's slide animation. Caller owns the
/// label; we only set its text. Capped at 12 dots — longer lists
/// get a trailing "+" so a 50-item home doesn't overrun the bottom
/// of the disc.
inline void updateDrumCursorDots(lv_obj_t* label, size_t n, size_t cur) {
    if (!label) return;
    char dots[64] = {0};
    size_t off = 0;
    const size_t cap = n > 12 ? 12 : n;
    for (size_t i = 0; i < cap && off < sizeof(dots) - 4; ++i) {
        dots[off++] = (i == cur) ? '#' : '-';
        dots[off++] = ' ';
    }
    if (n > cap && off < sizeof(dots) - 1) dots[off++] = '+';
    lv_label_set_text(label, dots);
}

}  // namespace howler::screens::components
