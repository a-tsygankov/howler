#pragma once

#include <Arduino.h>
#include <lvgl.h>
#include <stdint.h>

namespace howler::screens::components {

/// Helpers for the round-display look. The 240×240 GC9A01 LCD is
/// physically circular — corners are clipped — so any rectangular
/// child of `lv_scr_act` should be inset enough to live inside the
/// 240 px diameter inscribed circle. These helpers keep that math in
/// one place.

constexpr int kScreenW = 240;
constexpr int kScreenH = 240;
constexpr int kRadius  = 120;

/// Warm-domestic + dark-mode palettes ported from the webapp (per
/// `tailwind.config.ts`). Static accessors return colors based on
/// `Palette::activeIsDark()`, which the App's Settings → Theme
/// entry flips. Default: Light. Set via `Palette::setDark(bool)`.
struct Palette {
    static bool activeIsDark() { return darkActive_; }
    static void setDark(bool v) { darkActive_ = v; }

    // Light theme — warm paper / ink.
    // Dark theme — deep ink background, paper-tinted text. The
    // accent stays the same warm red so urgency reads identically
    // across themes.
    static lv_color_t paper() {
        return darkActive_ ? lv_color_make(0x1A, 0x14, 0x09)
                           : lv_color_make(0xF6, 0xEF, 0xDC);
    }
    static lv_color_t paper2() {
        return darkActive_ ? lv_color_make(0x2E, 0x26, 0x18)
                           : lv_color_make(0xEC, 0xE2, 0xC9);
    }
    static lv_color_t paper3() {
        return darkActive_ ? lv_color_make(0x44, 0x39, 0x27)
                           : lv_color_make(0xDF, 0xD2, 0xB1);
    }
    static lv_color_t ink() {
        return darkActive_ ? lv_color_make(0xF6, 0xEF, 0xDC)
                           : lv_color_make(0x1A, 0x14, 0x09);
    }
    static lv_color_t ink2() {
        return darkActive_ ? lv_color_make(0xC4, 0xB8, 0x9A)
                           : lv_color_make(0x57, 0x4E, 0x3E);
    }
    static lv_color_t ink3() {
        return darkActive_ ? lv_color_make(0x8E, 0x82, 0x6A)
                           : lv_color_make(0x8A, 0x80, 0x6E);
    }
    static lv_color_t line() {
        return darkActive_ ? lv_color_make(0x55, 0x49, 0x33)
                           : lv_color_make(0xC2, 0xB6, 0x98);
    }
    static lv_color_t lineSoft() {
        return darkActive_ ? lv_color_make(0x44, 0x39, 0x27)
                           : lv_color_make(0xD4, 0xC9, 0xA8);
    }
    static lv_color_t accent()     { return lv_color_make(0xC1, 0x3D, 0x1E); }
    static lv_color_t accentSoft() { return lv_color_make(0xE2, 0x96, 0x76); }
    static lv_color_t success() {
        return darkActive_ ? lv_color_make(0x57, 0xB0, 0x80)
                           : lv_color_make(0x2C, 0x77, 0x4B);
    }
    static lv_color_t warn() {
        return darkActive_ ? lv_color_make(0xE0, 0xA0, 0x40)
                           : lv_color_make(0xC8, 0x83, 0x10);
    }

private:
    inline static bool darkActive_ = false;
};

/// Build a full-circle paper-toned background filling the active
/// screen. Returns the container; subsequent widgets nest into it.
inline lv_obj_t* buildRoundBackground(lv_obj_t* parent = nullptr) {
    if (parent == nullptr) parent = lv_scr_act();
    auto* root = lv_obj_create(parent);
    lv_obj_set_size(root, kScreenW, kScreenH);
    lv_obj_center(root);
    lv_obj_clear_flag(root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(root, Palette::paper(), 0);
    lv_obj_set_style_radius(root, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(root, 0, 0);
    lv_obj_set_style_pad_all(root, 0, 0);
    return root;
}

/// Visual tab strip for the main screens. N pills side-by-side at
/// the top of the disc; the active one fills with ink (paper text),
/// the inactive ones stay paper3 (ink2 text). Pills are NOT
/// individually tappable — touch targets at pill width feel cramped
/// on the round display, so navigation between main screens is
/// owned by the round-display gestures (knob rotation + horizontal
/// swipe). The strip is purely a "you are here / these are
/// available" indicator.
struct TabStripEntry { const char* label; };
inline lv_obj_t* buildTabStrip(lv_obj_t* parent,
                               const TabStripEntry* entries, size_t count,
                               size_t activeIndex) {
    auto* row = lv_obj_create(parent);
    // Outer pill row; same width regardless of pill count so layout
    // stays steady.
    lv_obj_set_size(row, 192, 26);
    lv_obj_align(row, LV_ALIGN_TOP_MID, 0, 18);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_color(row, Palette::paper3(), 0);
    lv_obj_set_style_radius(row, 13, 0);
    lv_obj_set_style_border_width(row, 0, 0);
    lv_obj_set_style_pad_all(row, 2, 0);
    lv_obj_set_layout(row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_EVENLY,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    // Per-pill width. The outer is 192 minus 2×2 padding = 188; we
    // leave a small gap between pills via flex space-evenly.
    const int pillW = (count == 0) ? 60 : (188 / static_cast<int>(count)) - 2;
    for (size_t i = 0; i < count; ++i) {
        const bool active = (i == activeIndex);
        auto* pill = lv_obj_create(row);
        lv_obj_set_size(pill, pillW, 22);
        lv_obj_clear_flag(pill, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_clear_flag(pill, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_radius(pill, 11, 0);
        lv_obj_set_style_bg_color(pill,
            active ? Palette::ink() : Palette::paper3(), 0);
        lv_obj_set_style_shadow_width(pill, 0, 0);
        lv_obj_set_style_border_width(pill, 0, 0);
        lv_obj_set_style_pad_all(pill, 0, 0);

        auto* l = lv_label_create(pill);
        lv_label_set_text(l, entries[i].label);
        lv_obj_set_style_text_color(l,
            active ? Palette::paper() : Palette::ink2(), 0);
        lv_obj_center(l);
    }
    return row;
}

/// Build a circular content card centered on the parent. Smaller
/// than the screen so the arc indicators (urgency / hold-progress)
/// have room around it.
inline lv_obj_t* buildCenterCard(lv_obj_t* parent, int diameter,
                                 lv_color_t bg = Palette::paper2()) {
    auto* card = lv_obj_create(parent);
    lv_obj_set_size(card, diameter, diameter);
    lv_obj_center(card);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(card, bg, 0);
    lv_obj_set_style_radius(card, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_color(card, Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(card, 1, 0);
    lv_obj_set_style_pad_all(card, 16, 0);
    return card;
}

}  // namespace howler::screens::components
