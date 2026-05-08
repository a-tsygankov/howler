#pragma once

// Specialised numeric-input widgets — one per common result-type
// "shape" so the user gets purpose-built UI instead of a generic
// roller. Selected by `ResultType.unitName` (case-insensitive
// match against a small whitelist) with a numeric fallback for
// every other unit. All widgets honour the type's min/max/step
// from the shared `ResultEditModel`.
//
// The factory + concrete widgets live in this header so screens
// just call `makeValueWidget(rt)` once per ResultPicker entry and
// drive `update(value)` from the rotation handler.
//
// Visual conventions (per user spec 2026-05-08):
//
//   "stars" / "Rating"   row of gold-filled stars + remaining grey;
//                        horizontal swipe / tap a star / rotary
//                        nudges value
//   "gr" / "Grams"       bowl glyph with fill level + numeric on
//                        side; vertical swipe / rotary
//   "min" / "Minutes"    clock face — minute "hand" arc 0..60 + an
//                        inner hour arc when value > 60; horizontal
//                        swipe / rotary
//   "%"  / "Percent"     horizontal bar/ruler 0..100 with current
//                        value chip on top; horizontal swipe / tap
//                        on bar / rotary
//   anything else        big numeric value + unit (existing UX)

#include "RoundCard.h"
#include "../../domain/ResultType.h"

#include <Arduino.h>
#include <lvgl.h>
#include <stdio.h>
#include <math.h>
#include <memory>
#include <string>

namespace howler::screens::components {

class ValueWidget {
public:
    virtual ~ValueWidget() = default;
    /// Build the widget tree under `parent`. Caller owns the lifetime;
    /// when the parent is destroyed the widget's children go too.
    virtual void build(lv_obj_t* parent, const domain::ResultType& rt) = 0;
    /// Called once on entry and after every rotation/swipe to
    /// repaint the visual at the new value.
    virtual void update(double value, const domain::ResultType& rt) = 0;
};

// Format a value with decimals derived from step.
inline std::string formatValueFor(double v, double step) {
    char buf[32];
    if (step >= 1.0 - 1e-9) {
        snprintf(buf, sizeof(buf), "%lld",
            static_cast<long long>(v >= 0 ? v + 0.5 : v - 0.5));
    } else if (step >= 0.1 - 1e-9) {
        snprintf(buf, sizeof(buf), "%.1f", v);
    } else {
        snprintf(buf, sizeof(buf), "%.2f", v);
    }
    return std::string(buf);
}

// ── Numeric (default) ───────────────────────────────────────────
//
// The existing big-number-on-a-card layout, refactored as a widget
// so the picker uses the same code path as the specialised types.
class NumericValueWidget : public ValueWidget {
public:
    void build(lv_obj_t* parent, const domain::ResultType& rt) override {
        auto* card = buildCenterCard(parent, 156, Palette::paper2());

        valueLabel_ = lv_label_create(card);
        lv_obj_set_style_text_color(valueLabel_, Palette::ink(), 0);
        lv_obj_set_style_text_font(valueLabel_, &lv_font_montserrat_22, 0);
        lv_obj_align(valueLabel_, LV_ALIGN_CENTER, 0, -8);

        unitLabel_ = lv_label_create(card);
        lv_label_set_text(unitLabel_, rt.unitName.c_str());
        lv_obj_set_style_text_color(unitLabel_, Palette::ink2(), 0);
        lv_obj_align(unitLabel_, LV_ALIGN_CENTER, 0, 18);
    }
    void update(double value, const domain::ResultType& rt) override {
        if (!valueLabel_) return;
        lv_label_set_text(valueLabel_, formatValueFor(value, rt.step).c_str());
    }
private:
    lv_obj_t* valueLabel_ = nullptr;
    lv_obj_t* unitLabel_  = nullptr;
};

// ── Ruler / Percent ─────────────────────────────────────────────
//
// Horizontal bar 0..max, current value chip floats above the fill
// edge. Tap-on-ruler is wired by the picker (it knows the current
// edit model) — the widget itself just renders.
class RulerValueWidget : public ValueWidget {
public:
    void build(lv_obj_t* parent, const domain::ResultType& rt) override {
        // Big numeric on top.
        valueLabel_ = lv_label_create(parent);
        lv_obj_set_style_text_color(valueLabel_, Palette::ink(), 0);
        lv_obj_set_style_text_font(valueLabel_, &lv_font_montserrat_22, 0);
        lv_obj_align(valueLabel_, LV_ALIGN_CENTER, 0, -22);

        // Ruler bar.
        bar_ = lv_bar_create(parent);
        lv_obj_set_size(bar_, 180, 14);
        lv_obj_align(bar_, LV_ALIGN_CENTER, 0, 18);
        const int min = rt.hasMin ? static_cast<int>(rt.minValue) : 0;
        const int max = rt.hasMax ? static_cast<int>(rt.maxValue) : 100;
        lv_bar_set_range(bar_, min, max);
        lv_obj_set_style_bg_color(bar_, Palette::paper3(), LV_PART_MAIN);
        lv_obj_set_style_bg_color(bar_, Palette::accent(), LV_PART_INDICATOR);
        lv_obj_set_style_radius(bar_, 7, 0);
        lv_obj_set_style_radius(bar_, 7, LV_PART_INDICATOR);

        // Unit label below.
        auto* unit = lv_label_create(parent);
        lv_label_set_text(unit, rt.unitName.c_str());
        lv_obj_set_style_text_color(unit, Palette::ink3(), 0);
        lv_obj_align(unit, LV_ALIGN_CENTER, 0, 42);
    }
    void update(double value, const domain::ResultType& rt) override {
        if (valueLabel_) {
            lv_label_set_text(valueLabel_, formatValueFor(value, rt.step).c_str());
        }
        if (bar_) {
            lv_bar_set_value(bar_, static_cast<int>(value + 0.5), LV_ANIM_OFF);
        }
    }
private:
    lv_obj_t* valueLabel_ = nullptr;
    lv_obj_t* bar_        = nullptr;
};

// ── Stars / Rating ──────────────────────────────────────────────
//
// Row of small rounded squares. Filled gold = current value;
// remaining = grey. Five default stops when no max is set; when
// `hasMax` is true we render `max` stars total. Default font has no
// star glyph so we use small filled circles instead — communicates
// "rating" without depending on a custom font.
class StarsValueWidget : public ValueWidget {
public:
    void build(lv_obj_t* parent, const domain::ResultType& rt) override {
        const int max = rt.hasMax ? static_cast<int>(rt.maxValue) : 5;
        const int n = max < 1 ? 1 : (max > 10 ? 10 : max);

        row_ = lv_obj_create(parent);
        lv_obj_set_size(row_, 200, 36);
        lv_obj_align(row_, LV_ALIGN_CENTER, 0, 0);
        lv_obj_clear_flag(row_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_opa(row_, LV_OPA_0, 0);
        lv_obj_set_style_border_width(row_, 0, 0);
        lv_obj_set_style_pad_all(row_, 0, 0);
        lv_obj_set_layout(row_, LV_LAYOUT_FLEX);
        lv_obj_set_flex_flow(row_, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row_, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

        stars_.clear();
        stars_.reserve(static_cast<size_t>(n));
        for (int i = 0; i < n; ++i) {
            auto* s = lv_obj_create(row_);
            lv_obj_set_size(s, 22, 22);
            lv_obj_clear_flag(s, LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_set_style_radius(s, 11, 0);
            lv_obj_set_style_border_width(s, 0, 0);
            lv_obj_set_style_pad_all(s, 0, 0);
            lv_obj_set_style_margin_right(s, 4, 0);
            stars_.push_back(s);
        }

        // Numeric badge above the row so a glance value reading is
        // unambiguous (e.g. "3 / 5").
        valueLabel_ = lv_label_create(parent);
        lv_obj_set_style_text_color(valueLabel_, Palette::ink2(), 0);
        lv_obj_align(valueLabel_, LV_ALIGN_CENTER, 0, -42);

        auto* unit = lv_label_create(parent);
        lv_label_set_text(unit, rt.unitName.c_str());
        lv_obj_set_style_text_color(unit, Palette::ink3(), 0);
        lv_obj_align(unit, LV_ALIGN_CENTER, 0, 38);
    }
    void update(double value, const domain::ResultType& rt) override {
        const int filled = static_cast<int>(value + 0.5);
        for (size_t i = 0; i < stars_.size(); ++i) {
            const bool on = static_cast<int>(i) < filled;
            lv_obj_set_style_bg_color(stars_[i],
                on ? lv_color_make(0xC8, 0xA8, 0x2C)  // warm gold
                   : Palette::paper3(),
                0);
        }
        if (valueLabel_) {
            char buf[16];
            const int max = rt.hasMax ? static_cast<int>(rt.maxValue) : 5;
            snprintf(buf, sizeof(buf), "%d / %d", filled, max);
            lv_label_set_text(valueLabel_, buf);
        }
    }
private:
    lv_obj_t* row_ = nullptr;
    lv_obj_t* valueLabel_ = nullptr;
    std::vector<lv_obj_t*> stars_;
};

// ── Clock / Minutes ─────────────────────────────────────────────
//
// Round face with two concentric arcs:
//   outer (rim)  — minute "hand": fills 0..60 of the perimeter
//   inner        — hour "hand": fills 0..12 of the inner perimeter
// When value <= 60 the inner is hidden. Number in the centre.
class ClockValueWidget : public ValueWidget {
public:
    void build(lv_obj_t* parent, const domain::ResultType& rt) override {
        // Outer face circle (white).
        face_ = lv_obj_create(parent);
        lv_obj_set_size(face_, 156, 156);
        lv_obj_align(face_, LV_ALIGN_CENTER, 0, 0);
        lv_obj_clear_flag(face_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_radius(face_, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(face_, Palette::paper(), 0);
        lv_obj_set_style_border_color(face_, Palette::lineSoft(), 0);
        lv_obj_set_style_border_width(face_, 1, 0);
        lv_obj_set_style_pad_all(face_, 0, 0);

        minuteArc_ = lv_arc_create(face_);
        lv_obj_set_size(minuteArc_, 144, 144);
        lv_obj_center(minuteArc_);
        lv_arc_set_rotation(minuteArc_, 270);  // 12 o'clock
        lv_arc_set_bg_angles(minuteArc_, 0, 360);
        lv_arc_set_range(minuteArc_, 0, 60);
        lv_obj_remove_style(minuteArc_, nullptr, LV_PART_KNOB);
        lv_obj_clear_flag(minuteArc_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_arc_color(minuteArc_, Palette::paper3(), LV_PART_MAIN);
        lv_obj_set_style_arc_color(minuteArc_, Palette::accent(), LV_PART_INDICATOR);
        lv_obj_set_style_arc_width(minuteArc_, 6, LV_PART_MAIN);
        lv_obj_set_style_arc_width(minuteArc_, 6, LV_PART_INDICATOR);

        hourArc_ = lv_arc_create(face_);
        lv_obj_set_size(hourArc_, 96, 96);
        lv_obj_center(hourArc_);
        lv_arc_set_rotation(hourArc_, 270);
        lv_arc_set_bg_angles(hourArc_, 0, 360);
        lv_arc_set_range(hourArc_, 0, 12);
        lv_obj_remove_style(hourArc_, nullptr, LV_PART_KNOB);
        lv_obj_clear_flag(hourArc_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_arc_color(hourArc_, Palette::paper3(), LV_PART_MAIN);
        lv_obj_set_style_arc_color(hourArc_, Palette::ink2(), LV_PART_INDICATOR);
        lv_obj_set_style_arc_width(hourArc_, 4, LV_PART_MAIN);
        lv_obj_set_style_arc_width(hourArc_, 4, LV_PART_INDICATOR);

        valueLabel_ = lv_label_create(face_);
        lv_obj_set_style_text_color(valueLabel_, Palette::ink(), 0);
        lv_obj_set_style_text_font(valueLabel_, &lv_font_montserrat_22, 0);
        lv_obj_align(valueLabel_, LV_ALIGN_CENTER, 0, -2);

        unitLabel_ = lv_label_create(face_);
        lv_label_set_text(unitLabel_, rt.unitName.c_str());
        lv_obj_set_style_text_color(unitLabel_, Palette::ink2(), 0);
        lv_obj_align(unitLabel_, LV_ALIGN_CENTER, 0, 22);
    }
    void update(double value, const domain::ResultType& rt) override {
        const int total = static_cast<int>(value + 0.5);
        const int hours = total / 60;
        const int mins  = total % 60;
        if (minuteArc_) lv_arc_set_value(minuteArc_, mins);
        if (hourArc_) {
            lv_arc_set_value(hourArc_, hours % 12);
            // Hide the inner arc entirely until we cross an hour
            // boundary — keeps the simple "minutes only" clock
            // uncluttered for short timers.
            if (hours == 0) lv_obj_add_flag(hourArc_, LV_OBJ_FLAG_HIDDEN);
            else            lv_obj_clear_flag(hourArc_, LV_OBJ_FLAG_HIDDEN);
        }
        if (valueLabel_) {
            char buf[16];
            if (hours > 0) {
                snprintf(buf, sizeof(buf), "%d:%02d", hours, mins);
            } else {
                snprintf(buf, sizeof(buf), "%d", mins);
            }
            lv_label_set_text(valueLabel_, buf);
        }
        (void)rt;
    }
private:
    lv_obj_t* face_       = nullptr;
    lv_obj_t* minuteArc_  = nullptr;
    lv_obj_t* hourArc_    = nullptr;
    lv_obj_t* valueLabel_ = nullptr;
    lv_obj_t* unitLabel_  = nullptr;
};

// ── Bowl / Grams ────────────────────────────────────────────────
//
// Stylised bowl: outer half-disc shape with an inner fill rectangle
// rising from the bottom. When value reaches max we draw a small
// "mound" cap — a smaller half-circle centred on top of the fill —
// matching the user's reference visual. Numeric value sits to the
// right of the bowl so the silhouette stays clean.
class BowlValueWidget : public ValueWidget {
public:
    void build(lv_obj_t* parent, const domain::ResultType& rt) override {
        // The bowl: a half-circle outline. Implemented as a circular
        // container with the top half bg-clipped to paper so only
        // the bottom half reads as the bowl shape.
        bowl_ = lv_obj_create(parent);
        lv_obj_set_size(bowl_, 110, 110);
        lv_obj_align(bowl_, LV_ALIGN_CENTER, -28, 8);
        lv_obj_clear_flag(bowl_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_radius(bowl_, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(bowl_, Palette::paper2(), 0);
        lv_obj_set_style_border_color(bowl_, Palette::ink2(), 0);
        lv_obj_set_style_border_width(bowl_, 2, 0);
        lv_obj_set_style_pad_all(bowl_, 0, 0);
        // Mask the top half by stacking a paper rectangle that
        // covers the upper semicircle. Cheap, no clipping needed.
        topMask_ = lv_obj_create(parent);
        lv_obj_set_size(topMask_, 116, 56);
        lv_obj_align(topMask_, LV_ALIGN_CENTER, -28, -22);
        lv_obj_clear_flag(topMask_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_color(topMask_, Palette::paper(), 0);
        lv_obj_set_style_border_width(topMask_, 0, 0);
        lv_obj_set_style_radius(topMask_, 0, 0);
        lv_obj_set_style_pad_all(topMask_, 0, 0);

        // Food fill (inside the bowl, rising from the bottom).
        fill_ = lv_obj_create(bowl_);
        lv_obj_set_size(fill_, 100, 8);
        lv_obj_align(fill_, LV_ALIGN_BOTTOM_MID, 0, -4);
        lv_obj_clear_flag(fill_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_radius(fill_, 4, 0);
        lv_obj_set_style_bg_color(fill_, Palette::accentSoft(), 0);
        lv_obj_set_style_border_width(fill_, 0, 0);
        lv_obj_set_style_pad_all(fill_, 0, 0);

        // Mound — only revealed when fill is at max.
        mound_ = lv_obj_create(parent);
        lv_obj_set_size(mound_, 70, 24);
        lv_obj_align(mound_, LV_ALIGN_CENTER, -28, -32);
        lv_obj_clear_flag(mound_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_radius(mound_, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(mound_, Palette::accentSoft(), 0);
        lv_obj_set_style_border_width(mound_, 0, 0);
        lv_obj_set_style_pad_all(mound_, 0, 0);
        lv_obj_add_flag(mound_, LV_OBJ_FLAG_HIDDEN);

        // Numeric on the right.
        valueLabel_ = lv_label_create(parent);
        lv_obj_set_style_text_color(valueLabel_, Palette::ink(), 0);
        lv_obj_set_style_text_font(valueLabel_, &lv_font_montserrat_22, 0);
        lv_obj_align(valueLabel_, LV_ALIGN_CENTER, 50, -6);

        unitLabel_ = lv_label_create(parent);
        lv_label_set_text(unitLabel_, rt.unitName.c_str());
        lv_obj_set_style_text_color(unitLabel_, Palette::ink2(), 0);
        lv_obj_align(unitLabel_, LV_ALIGN_CENTER, 50, 18);
    }
    void update(double value, const domain::ResultType& rt) override {
        const double min = rt.hasMin ? rt.minValue : 0.0;
        const double max = rt.hasMax ? rt.maxValue : 100.0;
        const double range = max > min ? max - min : 1.0;
        double pct = (value - min) / range;
        if (pct < 0) pct = 0;
        if (pct > 1) pct = 1;
        const int fillH = static_cast<int>(8 + pct * 70);  // 8..78 px
        if (fill_) {
            lv_obj_set_size(fill_, 100, fillH);
            lv_obj_align(fill_, LV_ALIGN_BOTTOM_MID, 0, -4);
        }
        if (mound_) {
            const bool full = pct >= 0.999;
            if (full) lv_obj_clear_flag(mound_, LV_OBJ_FLAG_HIDDEN);
            else      lv_obj_add_flag(mound_, LV_OBJ_FLAG_HIDDEN);
        }
        if (valueLabel_) {
            lv_label_set_text(valueLabel_, formatValueFor(value, rt.step).c_str());
        }
    }
private:
    lv_obj_t* bowl_       = nullptr;
    lv_obj_t* topMask_    = nullptr;
    lv_obj_t* fill_       = nullptr;
    lv_obj_t* mound_      = nullptr;
    lv_obj_t* valueLabel_ = nullptr;
    lv_obj_t* unitLabel_  = nullptr;
};

// ── Factory ─────────────────────────────────────────────────────
//
// Pick the right widget for the result type. Match is on the unit
// name (case-insensitive, trimmed) — webapp + device share these
// strings so the device's choice mirrors what the home set up.
inline std::unique_ptr<ValueWidget> makeValueWidget(
    const domain::ResultType& rt) {
    std::string u = rt.unitName;
    for (auto& c : u) c = static_cast<char>(::tolower(c));
    if (u == "%" || u == "percent")
        return std::make_unique<RulerValueWidget>();
    if (u == "stars" || u == "star" || u == "rating")
        return std::make_unique<StarsValueWidget>();
    if (u == "min" || u == "mins" || u == "minutes" || u == "m")
        return std::make_unique<ClockValueWidget>();
    if (u == "g" || u == "gr" || u == "grams" || u == "gram")
        return std::make_unique<BowlValueWidget>();
    return std::make_unique<NumericValueWidget>();
}

}  // namespace howler::screens::components
