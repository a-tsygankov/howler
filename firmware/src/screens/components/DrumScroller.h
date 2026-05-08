#pragma once

// DrumScroller — a vertical "rotating drum" carousel of items. The
// selected item sits in the centre at full size; up to 3 items above
// and 3 below render at progressively smaller scale, simulating a
// drum that's been rotated so its faces are angling away from the
// viewer. Off-screen items don't render.
//
// Per-distance layout: each distance from the centre (0..3) has its
// own y-offset, slot width, slot height, and opacity, so the drum
// can do either a uniform-spacing menu (Settings, Wi-Fi, UserPicker)
// or a "peek-stack" task carousel (Dashboard, TaskList, per the
// design handoff) where neighbour rows progressively narrow + dim
// + overlap their nearer neighbour. The default layout is uniform —
// callers configure stack-style by calling setTierLayoutByDistance.
//
// The widget is fully parametrised: the caller supplies a render
// callback that fills a slot's lv_obj_t with whatever content suits
// the screen — text labels for menus or task cards (detail vs mini,
// keyed off the `tier` argument). The component's job is owning the
// 7 slot containers, positioning them on the disc, animating
// transitions between cursor positions, and propagating activate /
// scroll events back up.
//
// Z-order: closer-to-centre tiers paint on TOP of farther ones, so
// the peek-stack reads correctly (the closer mini sits flush; the
// farther mini's top/bottom is hidden by the closer one). Built into
// the layout-apply pass via lv_obj_move_foreground().
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
    /// fills with their tier-specific content. `tier` is in [-3, +3]
    /// where 0 is the centre / selected item; ±1 are the immediate
    /// neighbours; ±2 / ±3 are the far edges (typically smaller /
    /// faded / partially overlapped). `index` is the wrapped item
    /// index the slot represents.
    using RenderFn = std::function<void(lv_obj_t* slot,
                                        size_t index,
                                        int tier)>;

    using ActivateFn = std::function<void(size_t index)>;

    /// Per-distance slot configuration. `yOffset` is the absolute
    /// pixel distance from the container centre — DrumScroller mirrors
    /// it for negative tiers so a single layout entry covers both
    /// "above" and "below" at that distance. `width` × `height` is
    /// the slot bounding box (LV_ALIGN_CENTER inside the container);
    /// opacity dims the entire slot subtree. Defaults compute from
    /// the build()-time `tierSpacing` so callers that don't customise
    /// see the legacy uniform layout.
    struct TierLayout {
        int      yOffset = 0;
        int      width   = 0;
        int      height  = 0;
        lv_opa_t opacity = LV_OPA_COVER;
    };

    /// Build under `parent`, sizing the drum to fill the viewport.
    /// `viewWidth` × `viewHeight` is the bounding box; `tierSpacing`
    /// is how many pixels separate consecutive tiers in the *default*
    /// layout. Callers wanting non-uniform spacing call
    /// setTierLayoutByDistance after build().
    void build(lv_obj_t* parent, int viewWidth, int viewHeight,
               int tierSpacing = 56) {
        parent_       = parent;
        viewWidth_    = viewWidth;
        viewHeight_   = viewHeight;
        tierSpacing_  = tierSpacing;
        // The "container" is a transparent rectangle we translate
        // during scroll animations. Slots live inside; their static
        // y is `tier * tierSpacing` (default) so a container y of 0
        // means the selected item sits dead centre on the disc.
        container_ = lv_obj_create(parent);
        lv_obj_set_size(container_, viewWidth, viewHeight);
        lv_obj_align(container_, LV_ALIGN_CENTER, 0, 0);
        lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_opa(container_, LV_OPA_0, 0);
        lv_obj_set_style_border_width(container_, 0, 0);
        lv_obj_set_style_pad_all(container_, 0, 0);

        // Default to uniform tierSpacing so menu screens don't have
        // to opt in. Callers wanting the design's stack-style layout
        // call setTierLayoutByDistance after build().
        for (int d = 0; d <= kMaxDistance; ++d) {
            tierLayouts_[d] = TierLayout{
                /*yOffset=*/d * tierSpacing,
                /*width=*/viewWidth,
                /*height=*/tierSpacing,
                /*opacity=*/LV_OPA_COVER,
            };
        }

        for (int i = 0; i < kVisibleTiers; ++i) {
            slots_[i] = lv_obj_create(container_);
            lv_obj_clear_flag(slots_[i], LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_set_style_bg_opa(slots_[i], LV_OPA_0, 0);
            lv_obj_set_style_border_width(slots_[i], 0, 0);
            lv_obj_set_style_pad_all(slots_[i], 0, 0);
        }
        applyLayout();

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

    /// Override the layout for one distance from the centre. The
    /// centre slot is distance 0; the immediate neighbours above and
    /// below are distance 1; etc. Distances > kMaxDistance are
    /// silently ignored (we only render 7 tiers). The change takes
    /// effect immediately; call rebuild() afterwards if items have
    /// already been set so the new sizes propagate to the content.
    void setTierLayoutByDistance(int distance, const TierLayout& layout) {
        if (distance < 0 || distance > kMaxDistance) return;
        tierLayouts_[distance] = layout;
        applyLayout();
    }

    /// Cap how many neighbours render above / below the centre. A
    /// task drum on the 240×240 disc only has room for 2 minis on
    /// each side without the rim clipping them; menu screens that
    /// can use 3 leave this at the default. Distance 0 (the centre)
    /// always renders. Slots beyond the cap are hidden via opacity 0
    /// AND skipped during rebuild() so the render fn isn't called
    /// for them.
    void setMaxVisibleDistance(int d) {
        if (d < 0) d = 0;
        if (d > kMaxDistance) d = kMaxDistance;
        maxVisibleDistance_ = d;
        applyLayout();
        rebuild();
    }

    void setRender(RenderFn fn)  { render_ = std::move(fn); rebuild(); }
    void setOnActivate(ActivateFn fn) { onActivate_ = std::move(fn); }

    void setItemCount(size_t n) {
        itemCount_ = n;
        if (cursor_ >= n) cursor_ = n ? n - 1 : 0;
        // A live update (e.g. after a sync round shrunk the items
        // list) should redraw the drum immediately — without this,
        // a caller that updates the count without then changing the
        // cursor would render with stale slots until the next swipe
        // or screen rebuild. Rebuild bails when render_ isn't set
        // yet, so the build-time call sequence (setItemCount →
        // setCursor → setRender) stays correct: only the final
        // setRender actually paints.
        rebuild();
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

        // Slide distance: use the distance-1 yOffset as the per-step
        // travel — that's the gap a single cursor advance moves any
        // visible slot. Far-distance tiers don't sit at integer
        // multiples (the design's overlap math collapses them inward),
        // so basing the animation on distance-1 keeps the slide speed
        // visually proportional to the cursor change for each tier.
        const int perStep   = tierLayouts_[1].yOffset > 0
            ? tierLayouts_[1].yOffset : tierSpacing_;
        const int slideFrom = steps * perStep;
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
            // tier-2 aliases tier+1; n=6, tier-3 aliases tier+3.
            // Rendering the same item at two tiers looks broken (the
            // user sees one row "echoing" the other), so we hide far
            // slots until the list is long enough that no two visible
            // tiers collide. Boundaries:
            //   tier ±1 safe iff n ≥ 3 (n=2 aliases ±1 to each other,
            //                           accept it — the drum still
            //                           rotates cleanly with two)
            //   tier ±2 safe iff n ≥ 5
            //   tier ±3 safe iff n ≥ 7
            const int dist = tier < 0 ? -tier : tier;
            if (dist > maxVisibleDistance_) continue;
            if (itemCount_ == 0) continue;
            if (itemCount_ == 1 && tier != 0) continue;
            if (itemCount_ < 5  && (tier == -2 || tier == 2)) continue;
            if (itemCount_ < 7  && (tier == -3 || tier == 3)) continue;
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
    /// Number of slots we keep alive. 7 = centre + 3 above + 3 below,
    /// matching the design handoff's STACK constants (insets / dim /
    /// scale arrays each have 4 entries indexed by abs distance 0..3).
    /// We could grow it, but the 240×240 disc has no room for a
    /// fourth ring inside the safe area.
    static constexpr int kVisibleTiers = 7;
    static constexpr int kCentreSlot   = 3;  // index in `slots_[]`
    static constexpr int kMaxDistance  = 3;

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

    /// Push the per-distance layout into each slot. Run on build()
    /// and again on every setTierLayoutByDistance() so a screen can
    /// mutate its layout after construction. Also enforces z-order:
    /// closer-to-centre tiers paint on top of farther ones, which is
    /// what makes the peek-stack overlap read correctly (the closer
    /// mini's edge hides part of the farther mini).
    void applyLayout() {
        if (!container_) return;
        for (int i = 0; i < kVisibleTiers; ++i) {
            if (!slots_[i]) continue;
            const int tier = i - kCentreSlot;
            const int dist = tier < 0 ? -tier : tier;
            const auto& L = tierLayouts_[dist > kMaxDistance
                                         ? kMaxDistance : dist];
            const int signedY = (tier < 0) ? -L.yOffset : L.yOffset;
            const int w = L.width  > 0 ? L.width  : viewWidth_;
            const int h = L.height > 0 ? L.height : tierSpacing_;
            lv_obj_set_size(slots_[i], w, h);
            lv_obj_align(slots_[i], LV_ALIGN_CENTER, 0, signedY);
            // Beyond the visibility cap → fully transparent so the
            // slot still exists (drum logic stays simple) but the
            // user sees nothing. Slot content is also skipped in
            // rebuild() to avoid wasting LVGL allocations on it.
            const lv_opa_t opa = (dist > maxVisibleDistance_)
                ? LV_OPA_TRANSP : L.opacity;
            lv_obj_set_style_opa(slots_[i], opa, 0);
        }
        // Z-order: walk distances from the rim inward, calling
        // move_foreground each step so the centre ends up on top.
        // Cheap (one LVGL list reorder per tier) and runs only when
        // layout changes, not per-frame.
        for (int dist = kMaxDistance; dist >= 0; --dist) {
            const int above = kCentreSlot - dist;
            const int below = kCentreSlot + dist;
            if (above != below && above >= 0 && slots_[above]) {
                lv_obj_move_foreground(slots_[above]);
            }
            if (below < kVisibleTiers && slots_[below]) {
                lv_obj_move_foreground(slots_[below]);
            }
        }
    }

    lv_obj_t*  parent_      = nullptr;
    lv_obj_t*  container_   = nullptr;
    lv_obj_t*  slots_[kVisibleTiers] = {};
    int        viewWidth_   = 0;
    int        viewHeight_  = 0;
    int        tierSpacing_ = 56;
    size_t     itemCount_   = 0;
    size_t     cursor_      = 0;
    int        maxVisibleDistance_ = kMaxDistance;
    TierLayout tierLayouts_[kMaxDistance + 1] = {};
    RenderFn   render_;
    ActivateFn onActivate_;
};

/// Render a "# - - - -" cursor-dots strip for the given (size, cursor)
/// pair. Legacy bottom-of-screen indicator; the design handoff replaces
/// it with the rim indicator below for the task drum but other screens
/// still use this. Caller owns the label; we only set its text.
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

/// Right-rim vertical scroll indicator per the design handoff:
/// 3 px wide dots stacked at x ≈ 226 (8 px from rim), centred on
/// the disc, with the active dot drawn as a 10 px tall pill in
/// foreground colour. Returns the wrapping container so callers
/// can keep a member ref + call updateDrumRimIndicator on each
/// scroll. Caller owns parent; we only build into it.
inline lv_obj_t* buildDrumRimIndicator(lv_obj_t* parent,
                                       size_t n, size_t cur) {
    auto* col = lv_obj_create(parent);
    // Cap dot count so long lists don't overrun the disc's vertical
    // safe area. The design says 3 px wide dots; a 12-dot column
    // with 3 px gaps is 12*3 + 11*3 = 69 px tall, comfortably
    // inside the 200 px safe height.
    const size_t cap = n > 12 ? 12 : n;
    const int dotH   = 3;
    const int gap    = 3;
    const int colH   = static_cast<int>(cap) * dotH
                     + (static_cast<int>(cap) - 1) * gap
                     + (10 - dotH);  // active dot is 10 px tall
    lv_obj_set_size(col, 6, colH);
    lv_obj_align(col, LV_ALIGN_RIGHT_MID, -8, 0);
    lv_obj_clear_flag(col, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(col, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(col, LV_OPA_0, 0);
    lv_obj_set_style_border_width(col, 0, 0);
    lv_obj_set_style_pad_all(col, 0, 0);
    // Dots are positioned manually so the active one can grow taller
    // without throwing off the column rhythm.
    int y = 0;
    for (size_t i = 0; i < cap; ++i) {
        const bool active = (i == cur);
        auto* dot = lv_obj_create(col);
        lv_obj_set_size(dot, 3, active ? 10 : dotH);
        lv_obj_set_pos(dot, 0, y);
        lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_radius(dot, 2, 0);
        lv_obj_set_style_bg_color(dot,
            active ? Palette::ink() : Palette::lineSoft(), 0);
        lv_obj_set_style_border_width(dot, 0, 0);
        lv_obj_set_style_pad_all(dot, 0, 0);
        y += (active ? 10 : dotH) + gap;
    }
    return col;
}

/// Re-render the rim indicator in place — wipes children and rebuilds
/// at the new cursor. Called from the screen's scroll handler so the
/// active-dot position tracks the drum's animation.
inline void updateDrumRimIndicator(lv_obj_t* col, size_t n, size_t cur) {
    if (!col) return;
    lv_obj_clean(col);
    const size_t cap = n > 12 ? 12 : n;
    const int dotH   = 3;
    const int gap    = 3;
    int y = 0;
    for (size_t i = 0; i < cap; ++i) {
        const bool active = (i == cur);
        auto* dot = lv_obj_create(col);
        lv_obj_set_size(dot, 3, active ? 10 : dotH);
        lv_obj_set_pos(dot, 0, y);
        lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_radius(dot, 2, 0);
        lv_obj_set_style_bg_color(dot,
            active ? Palette::ink() : Palette::lineSoft(), 0);
        lv_obj_set_style_border_width(dot, 0, 0);
        lv_obj_set_style_pad_all(dot, 0, 0);
        y += (active ? 10 : dotH) + gap;
    }
}

}  // namespace howler::screens::components
