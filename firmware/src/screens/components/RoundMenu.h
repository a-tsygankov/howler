#pragma once

#include "RoundCard.h"
#include "../../domain/RoundMenuModel.h"

#include <Arduino.h>
#include <functional>
#include <lvgl.h>

namespace howler::screens::components {

/// A round-display-friendly menu — visually a watch-style carousel.
/// The selected item sits in the centre rendered big; the previous /
/// next items show as smaller text above and below; far-away items
/// are hidden. Rotation events from the encoder cycle the cursor;
/// the calling screen handles tap → activate via `setOnActivate()`.
///
/// Why not lv_list: lv_list is a vertical rectangle. On a 240×240
/// circular display the corners are clipped and a flat list looks
/// jarring against the circular bezel. The carousel keeps the
/// interactive surface inside the circle and makes the selected
/// item unambiguous (size + brightness, not a focus ring).
///
/// The component is stateless w.r.t. the items — owners pass items
/// via a `domain::RoundMenuModel` reference (so the model is
/// authoritative for cursor, sort, and additions/removals). The
/// widget rebuilds on every `refresh()` call; cheap because we only
/// have a handful of labels.
class RoundMenu {
public:
    using ActivateFn = std::function<void(const domain::RoundMenuItem&)>;

    /// Build the carousel widgets into `parent`. Pass an existing
    /// model — RoundMenu reads from it on every refresh().
    void build(lv_obj_t* parent, domain::RoundMenuModel& model) {
        model_ = &model;
        parent_ = parent;

        // Centre row: the headline item.
        centreContainer_ = lv_obj_create(parent);
        lv_obj_set_size(centreContainer_, 200, 80);
        lv_obj_align(centreContainer_, LV_ALIGN_CENTER, 0, 0);
        lv_obj_clear_flag(centreContainer_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_color(centreContainer_, Palette::paper2(), 0);
        lv_obj_set_style_radius(centreContainer_, 20, 0);
        lv_obj_set_style_border_color(centreContainer_, Palette::lineSoft(), 0);
        lv_obj_set_style_border_width(centreContainer_, 1, 0);
        lv_obj_set_style_pad_all(centreContainer_, 6, 0);

        centreTitle_ = lv_label_create(centreContainer_);
        lv_label_set_long_mode(centreTitle_, LV_LABEL_LONG_DOT);
        lv_obj_set_width(centreTitle_, 180);
        lv_obj_set_style_text_align(centreTitle_, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_style_text_color(centreTitle_, Palette::ink(), 0);
        lv_obj_set_style_text_font(centreTitle_, &lv_font_montserrat_22, 0);
        lv_obj_align(centreTitle_, LV_ALIGN_CENTER, 0, -8);

        centreSubtitle_ = lv_label_create(centreContainer_);
        lv_obj_set_style_text_color(centreSubtitle_, Palette::ink2(), 0);
        lv_obj_align(centreSubtitle_, LV_ALIGN_CENTER, 0, 16);

        // Above + below: the neighbours, smaller / muted.
        prevLabel_ = lv_label_create(parent);
        lv_label_set_long_mode(prevLabel_, LV_LABEL_LONG_DOT);
        lv_obj_set_width(prevLabel_, 180);
        lv_obj_set_style_text_align(prevLabel_, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_style_text_color(prevLabel_, Palette::ink3(), 0);
        lv_obj_align(prevLabel_, LV_ALIGN_TOP_MID, 0, 32);

        nextLabel_ = lv_label_create(parent);
        lv_label_set_long_mode(nextLabel_, LV_LABEL_LONG_DOT);
        lv_obj_set_width(nextLabel_, 180);
        lv_obj_set_style_text_align(nextLabel_, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_style_text_color(nextLabel_, Palette::ink3(), 0);
        lv_obj_align(nextLabel_, LV_ALIGN_BOTTOM_MID, 0, -32);

        // Tap target — the centre container is invisible to clicks
        // by default (lv_obj from a flex parent), so wire an explicit
        // event callback. Tap on the centre = activate.
        lv_obj_add_flag(centreContainer_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(centreContainer_,
            [](lv_event_t* e) {
                if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
                auto* self = static_cast<RoundMenu*>(lv_event_get_user_data(e));
                if (self) self->fireActivate();
            }, LV_EVENT_CLICKED, this);

        refresh();
    }

    /// Re-render labels after a model mutation (cursor change,
    /// items replaced). Cheap; just sets text.
    void refresh() {
        if (!model_ || !centreTitle_) return;
        const auto& items = model_->items();
        if (items.empty()) {
            lv_label_set_text(centreTitle_, "(empty)");
            lv_label_set_text(centreSubtitle_, "");
            lv_label_set_text(prevLabel_, "");
            lv_label_set_text(nextLabel_, "");
            return;
        }
        const size_t n = items.size();
        const size_t cur = model_->cursor();
        const size_t prev = (cur + n - 1) % n;
        const size_t next = (cur + 1) % n;

        const auto& curItem  = items[cur];
        const auto& prevItem = items[prev];
        const auto& nextItem = items[next];

        lv_label_set_text(centreTitle_, curItem.title.c_str());
        lv_label_set_text(centreSubtitle_, curItem.subtitle.c_str());

        // If only one item, hide the neighbour labels — otherwise the
        // same string would render thrice and look broken.
        if (n == 1) {
            lv_label_set_text(prevLabel_, "");
            lv_label_set_text(nextLabel_, "");
        } else {
            lv_label_set_text(prevLabel_, prevItem.title.c_str());
            lv_label_set_text(nextLabel_, nextItem.title.c_str());
        }

        // Centre accent — destructive items get the accent border so
        // the user notices before long-pressing.
        const lv_color_t border = curItem.destructive ? Palette::accent()
                                                       : Palette::lineSoft();
        lv_obj_set_style_border_color(centreContainer_, border, 0);
        lv_obj_set_style_border_width(centreContainer_,
            curItem.destructive ? 2 : 1, 0);
    }

    /// Owner registers a callback that runs when the centre item is
    /// activated (tap / knob press). The screen layer translates this
    /// into router pushes / commits as needed.
    void setOnActivate(ActivateFn fn) { onActivate_ = std::move(fn); }

    /// Translate a rotation delta (knob CW/CCW) into a cursor move.
    /// Returns true if the cursor changed; the caller can choose to
    /// re-call refresh() (or skip if it already does).
    bool onRotate(int delta) {
        if (!model_ || delta == 0) return false;
        model_->moveCursor(delta);
        refresh();
        return true;
    }

    /// Activate the centre item from outside (e.g., the screen's tap
    /// handler in ScreenManager::onEvent — useful when LVGL's own
    /// click event isn't routed through, or to keep activation logic
    /// in one place).
    void fireActivate() {
        if (!model_ || !onActivate_) return;
        const auto* sel = model_->selected();
        if (sel) onActivate_(*sel);
    }

private:
    domain::RoundMenuModel* model_ = nullptr;
    lv_obj_t* parent_ = nullptr;
    lv_obj_t* centreContainer_ = nullptr;
    lv_obj_t* centreTitle_ = nullptr;
    lv_obj_t* centreSubtitle_ = nullptr;
    lv_obj_t* prevLabel_ = nullptr;
    lv_obj_t* nextLabel_ = nullptr;
    ActivateFn onActivate_;
};

}  // namespace howler::screens::components
