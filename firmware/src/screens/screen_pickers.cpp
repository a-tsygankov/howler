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
        lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 12);
    }

    // Round-menu carousel: "skip" pinned first (so the most-common
    // action is one tap from entry), then each home user. The id
    // "skip" routes to a userId-empty commit; non-skip ids ARE the
    // userId.
    std::vector<domain::RoundMenuItem> items;
    items.reserve(1 + app_.users().size());
    {
        domain::RoundMenuItem skip;
        skip.id = "skip";
        skip.title = "skip";
        skip.subtitle = "no attribution";
        items.push_back(std::move(skip));
    }
    for (const auto& u : app_.users()) {
        domain::RoundMenuItem it;
        it.id = u.id;
        it.title = u.displayName.empty() ? u.id : u.displayName;
        if (!u.login.empty()) it.subtitle = u.login;
        items.push_back(std::move(it));
    }
    menuModel_.replace(std::move(items));
    menu_.build(root_, menuModel_);
    menu_.refresh();
    menu_.setOnActivate([this](const domain::RoundMenuItem& it) {
        auto& app = this->app();
        app.pendingDone().userId = (it.id == "skip") ? std::string{} : it.id;
        app.commitPendingDone();
        app.router().replaceRoot(domain::ScreenId::Dashboard);
    });
    menuActive_ = true;

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate · tap pick · hold skip");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

}  // namespace howler::screens
