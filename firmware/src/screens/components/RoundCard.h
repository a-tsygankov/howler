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

/// Warm-domestic palette ported verbatim from the webapp (per
/// `docs/design_handoff_howler/styles.css` via `tailwind.config.ts`).
/// Inline here so screens don't depend on a runtime theme system.
struct Palette {
    static lv_color_t paper()      { return lv_color_make(0xF6, 0xEF, 0xDC); }
    static lv_color_t paper2()     { return lv_color_make(0xEC, 0xE2, 0xC9); }
    static lv_color_t paper3()     { return lv_color_make(0xDF, 0xD2, 0xB1); }
    static lv_color_t ink()        { return lv_color_make(0x1A, 0x14, 0x09); }
    static lv_color_t ink2()       { return lv_color_make(0x57, 0x4E, 0x3E); }
    static lv_color_t ink3()       { return lv_color_make(0x8A, 0x80, 0x6E); }
    static lv_color_t line()       { return lv_color_make(0xC2, 0xB6, 0x98); }
    static lv_color_t lineSoft()   { return lv_color_make(0xD4, 0xC9, 0xA8); }
    static lv_color_t accent()     { return lv_color_make(0xC1, 0x3D, 0x1E); }
    static lv_color_t accentSoft() { return lv_color_make(0xE2, 0x96, 0x76); }
    static lv_color_t success()    { return lv_color_make(0x2C, 0x77, 0x4B); }
    static lv_color_t warn()       { return lv_color_make(0xC8, 0x83, 0x10); }
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
