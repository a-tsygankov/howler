// Polished mark-done flow: ResultPicker → UserPicker → commit.
//
// New interaction model (per user spec 2026-05-07):
//   ROTATE  on ResultPicker  → nudge value by one step
//   TAP     on ResultPicker  → accept value, advance to UserPicker
//   LONG    on ResultPicker  → skip value entirely, advance
//   ROTATE  on UserPicker    → cycle the highlighted user
//   TAP     on UserPicker    → commit with that user
//   DOUBLE  on either        → universal back (handled in
//                              ScreenManager::onEvent)
//   LONG    on UserPicker    → skip user attribution, commit
//
// The ResultPicker uses a big centered numeric label driven by
// `App::resultEdit()` (host-tested ResultEditModel). The UserPicker
// is a round-display list of user names + a "skip" entry on top.
// Both pre-fill from the most-recently-entered values when possible
// — the user spec calls last-value defaulting "critical".

#include "ScreenManager.h"
#include "components/RoundCard.h"
#include "components/LongPressArcWidget.h"
#include <stdio.h>
#include <stdlib.h>

namespace howler::screens {

using components::Palette;
using components::buildRoundBackground;
using components::buildCenterCard;

void ScreenManager::buildResultPicker() {
    root_ = buildRoundBackground();
    longPressArcWidget_.build(root_, Palette::ink2());

    auto& app = app_;
    auto& edit = app.resultEdit();
    const auto& pending = app.pendingDone();
    const auto* rt = app.findResultType(pending.resultTypeId);

    if (!rt) {
        // Nothing to enter — bounce straight through. Belt-and-braces:
        // the dashboard's tap handler already short-circuits this case
        // via `resultTypeId.empty()`, but if the result type was deleted
        // server-side between the dashboard fetch and the press we end
        // up here.
        auto* l = lv_label_create(root_);
        lv_label_set_text(l, "no result type\n(tap to skip)");
        lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
        lv_obj_center(l);
        return;
    }

    // Pre-seed the editor from last execution / default / min on each
    // entry to this screen. Cheap; idempotent.
    double last = 0.0;
    const bool hasLast = app.lastValueForTask(pending.taskId, last);
    edit.reset(*rt, last, hasLast);

    // Top: result type display name.
    {
        auto* name = lv_label_create(root_);
        lv_label_set_text(name, rt->displayName.empty()
                                ? rt->unitName.c_str()
                                : rt->displayName.c_str());
        lv_obj_set_style_text_color(name, Palette::ink2(), 0);
        lv_obj_align(name, LV_ALIGN_TOP_MID, 0, 22);
    }

    // Center: big value + unit, on a circular card. The value label
    // pointer is cached on ScreenManager so onEvent can update it
    // in place per detent (avoids screen-tree rebuild flicker).
    auto* card = buildCenterCard(root_, 156, Palette::paper2());
    {
        auto* val = lv_label_create(card);
        lv_label_set_text(val, edit.formatValue().c_str());
        lv_obj_set_style_text_color(val, Palette::ink(), 0);
        lv_obj_set_style_text_font(val, &lv_font_montserrat_22, 0);
        lv_obj_align(val, LV_ALIGN_CENTER, 0, -8);
        resultValueLabel_ = val;

        auto* unit = lv_label_create(card);
        lv_label_set_text(unit, rt->unitName.c_str());
        lv_obj_set_style_text_color(unit, Palette::ink2(), 0);
        lv_obj_align(unit, LV_ALIGN_CENTER, 0, 18);
    }

    // Bottom: last-value chip when applicable.
    if (hasLast) {
        auto* chip = lv_obj_create(root_);
        lv_obj_set_size(chip, 130, 22);
        lv_obj_align(chip, LV_ALIGN_BOTTOM_MID, 0, -34);
        lv_obj_clear_flag(chip, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_radius(chip, 11, 0);
        lv_obj_set_style_bg_color(chip, Palette::paper3(), 0);
        lv_obj_set_style_border_width(chip, 0, 0);
        lv_obj_set_style_pad_all(chip, 0, 0);

        auto* l = lv_label_create(chip);
        char hint[48];
        snprintf(hint, sizeof(hint), "last: %s %s",
                 edit.formatLast().c_str(), rt->unitName.c_str());
        lv_label_set_text(l, hint);
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
        lv_obj_center(l);
    }

    // Hint: rotate / tap / hold semantics.
    {
        auto* hint = lv_label_create(root_);
        lv_label_set_text(hint, "rotate · tap save · hold skip");
        lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
        lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
    }
}

void ScreenManager::buildUserPicker() {
    root_ = buildRoundBackground();
    longPressArcWidget_.build(root_, Palette::ink2());

    {
        auto* title = lv_label_create(root_);
        lv_label_set_text(title, "who did it?");
        lv_obj_set_style_text_color(title, Palette::ink2(), 0);
        lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 16);
    }

    // Round-cropped list. LVGL's lv_list is rectangular but on a
    // 240x240 disc the corner items get clipped — the visible region
    // (about 200×140 inset) is plenty for 3-4 entries plus the
    // always-on-top "skip" row.
    auto* list = lv_list_create(root_);
    lv_obj_set_size(list, 200, 130);
    lv_obj_align(list, LV_ALIGN_CENTER, 0, 6);
    lv_obj_set_style_bg_color(list, Palette::paper2(), 0);
    lv_obj_set_style_radius(list, 14, 0);
    lv_obj_set_style_border_color(list, Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(list, 1, 0);
    lv_obj_set_style_pad_all(list, 4, 0);

    // First row is always "skip" so the user can commit without
    // attribution in one tap. Long-press anywhere on the screen
    // also commits-and-skips (handled in ScreenManager::onEvent).
    auto* skip = lv_list_add_btn(list, LV_SYMBOL_MINUS, "skip");
    if (group_) {
        lv_group_add_obj(group_, skip);
        lv_group_focus_obj(skip);
    }
    lv_obj_add_event_cb(skip, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        mgr->app().pendingDone().userId.clear();
        mgr->app().commitPendingDone();
        mgr->app().router().replaceRoot(domain::ScreenId::Dashboard);
    }, LV_EVENT_CLICKED, this);

    for (const auto& u : app_.users()) {
        auto* btn = lv_list_add_btn(list, LV_SYMBOL_OK,
            u.displayName.empty() ? u.id.c_str() : u.displayName.c_str());
        if (group_) lv_group_add_obj(group_, btn);
        auto* idCopy = static_cast<char*>(lv_malloc(u.id.size() + 1));
        memcpy(idCopy, u.id.c_str(), u.id.size() + 1);
        lv_obj_set_user_data(btn, idCopy);
        lv_obj_add_event_cb(btn, [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
            auto* btn = lv_event_get_target_obj(e);
            const char* uid = static_cast<const char*>(lv_obj_get_user_data(btn));
            mgr->app().pendingDone().userId = uid ? uid : "";
            mgr->app().commitPendingDone();
            mgr->app().router().replaceRoot(domain::ScreenId::Dashboard);
        }, LV_EVENT_CLICKED, this);
    }

    // Footer: gestures legend.
    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "tap pick · hold skip · double back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -8);
}

}  // namespace howler::screens
