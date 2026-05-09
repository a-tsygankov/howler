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
#include "components/ValueWidget.h"
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
        // Belt-and-braces. The dashboard / tasklist tap handlers
        // short-circuit when findResultType returns nullptr (clear
        // resultTypeId, push UserPicker directly), so this branch
        // shouldn't fire on a healthy device. If it ever does —
        // e.g. the result type was deleted server-side AFTER the
        // tap but BEFORE this build — strip resultTypeId so the
        // picker's tap handler doesn't propagate a stale
        // resultValue from a previous pick.
        app.pendingDone().resultTypeId = "";
        app.pendingDone().hasResultValue = false;
        auto* l = lv_label_create(root_);
        lv_label_set_text(l, "result type missing\n(2x back)");
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

    // Centre value visual — picked by unit name. The factory returns
    // a NumericValueWidget for anything not in the specialised list,
    // so the picker stays a one-screen shape no matter what unit
    // the home configures. We park the widget on ScreenManager so
    // ::onEvent can call update() per detent without a full rebuild.
    valueWidget_ = components::makeValueWidget(*rt);
    valueWidget_->build(root_, *rt);
    valueWidget_->update(edit.value(), *rt);
    // Legacy single-label cache stays nullptr — the new path drives
    // updates through valueWidget_ instead.
    resultValueLabel_ = nullptr;

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
        lv_label_set_text(hint, "rotate | tap save | hold skip");
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
        // Show the green-check animation BEFORE the router transition
        // so the overlay (on lv_layer_top) survives the screen rebuild
        // and the user sees the confirmation beat against whichever
        // screen we land on.
        this->playDoneAnimation();
        app.router().replaceRoot(domain::ScreenId::Dashboard);
    });
    menuActive_ = true;

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate | tap pick | hold skip");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

}  // namespace howler::screens
