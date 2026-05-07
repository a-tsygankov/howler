#pragma once

#include "RoundCard.h"
#include "../../domain/LongPressArc.h"

#include <Arduino.h>
#include <lvgl.h>

namespace howler::screens::components {

/// Renders the `domain::LongPressArc` model as an LVGL arc that fills
/// the perimeter of the round display. Color is the screen's accent
/// (red for the dashboard's "urgent confirm"; ink for everything
/// else); the arc snaps from invisible (Idle) to growing-clockwise
/// (Charging) to a brief flash (Fired). Construct once per screen,
/// call `update()` every frame from the screen's tick handler.
class LongPressArcWidget {
public:
    /// `accent` is the colour of the filled portion. The track
    /// (unfilled remainder) is rendered in lineSoft.
    void build(lv_obj_t* parent, lv_color_t accent = Palette::accent()) {
        accent_ = accent;
        arc_ = lv_arc_create(parent);
        lv_obj_set_size(arc_, kScreenW - 4, kScreenH - 4);
        lv_obj_center(arc_);
        lv_arc_set_rotation(arc_, 270);   // start at top
        lv_arc_set_bg_angles(arc_, 0, 360);
        lv_arc_set_value(arc_, 0);
        lv_arc_set_range(arc_, 0, 100);

        // Make non-interactive (we drive it programmatically; no
        // touchpad target on the round perimeter).
        lv_obj_clear_flag(arc_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_style(arc_, nullptr, LV_PART_KNOB);

        // Track (unfilled) styled subtle so it doesn't compete with
        // the screen content while the arc is empty.
        lv_obj_set_style_arc_color(arc_, Palette::lineSoft(), LV_PART_MAIN);
        lv_obj_set_style_arc_width(arc_, 6, LV_PART_MAIN);

        // Filled portion in accent.
        lv_obj_set_style_arc_color(arc_, accent_, LV_PART_INDICATOR);
        lv_obj_set_style_arc_width(arc_, 6, LV_PART_INDICATOR);

        lv_obj_add_flag(arc_, LV_OBJ_FLAG_HIDDEN);
    }

    void update(const domain::LongPressArc& model) {
        if (!arc_) return;
        using Phase = domain::LongPressArc::Phase;
        if (model.phase() == Phase::Idle) {
            lv_obj_add_flag(arc_, LV_OBJ_FLAG_HIDDEN);
            return;
        }
        lv_obj_clear_flag(arc_, LV_OBJ_FLAG_HIDDEN);
        const int v = static_cast<int>(model.progress() * 100.0f + 0.5f);
        lv_arc_set_value(arc_, v);
    }

    void hide() {
        if (arc_) lv_obj_add_flag(arc_, LV_OBJ_FLAG_HIDDEN);
    }

    /// Drop the cached LVGL pointer. ScreenManager calls this in
    /// teardownScreen() before the parent root_ is destroyed, so the
    /// widget doesn't dereference freed memory next frame.
    void reset() { arc_ = nullptr; }

private:
    lv_obj_t*   arc_    = nullptr;
    lv_color_t  accent_ = Palette::accent();
};

}  // namespace howler::screens::components
