// All-tasks screen — round-menu carousel over `App::allTasks()`. The
// dashboard model holds only the urgency-filtered subset; this view
// shows every active task in the home regardless of tier so the user
// can mark anything done from the dial without waiting for the
// urgency rule to surface it.
//
// Tap = enter the same mark-done flow the dashboard uses; double-tap
// = pop back to Settings; long-press = quick mark-done (no result,
// no user) the same as on the dashboard.

#include "ScreenManager.h"
#include "components/RoundCard.h"
#include <stdio.h>

namespace howler::screens {

using components::Palette;
using components::buildRoundBackground;
using components::buildCenterCard;

namespace {

const char* tierLabel(howler::domain::Urgency u, bool missed) {
    if (missed) return "missed";
    switch (u) {
        case howler::domain::Urgency::Urgent:    return "urgent";
        case howler::domain::Urgency::NonUrgent: return "soon";
        case howler::domain::Urgency::Hidden:    return "scheduled";
    }
    return "";
}

}  // namespace

void ScreenManager::buildTaskList() {
    root_ = buildRoundBackground();
    longPressArcWidget_.build(root_, Palette::accent());

    // Tab strip — same shape as Dashboard so the user always sees
    // both views available regardless of which is active.
    {
        components::TabStripEntry entries[] = {
            {"today", reinterpret_cast<const void*>(static_cast<intptr_t>(domain::ScreenId::Dashboard))},
            {"all",   reinterpret_cast<const void*>(static_cast<intptr_t>(domain::ScreenId::TaskList))},
        };
        components::buildTabStrip(root_, entries, 2, /*activeIndex=*/1,
            [](lv_event_t* e) {
                if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
                auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
                auto* btn = lv_event_get_target_obj(e);
                const auto target = static_cast<domain::ScreenId>(
                    reinterpret_cast<intptr_t>(lv_obj_get_user_data(btn)));
                mgr->app().router().replaceRoot(target);
            }, this);
    }

    auto& all = app_.allTasks();
    if (all.empty()) {
        auto* card = buildCenterCard(root_, 180, Palette::paper2());
        auto* l = lv_label_create(card);
        lv_label_set_text(l, "no tasks yet");
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
        lv_obj_center(l);
        auto* hint = lv_label_create(root_);
        lv_label_set_text(hint, "double back");
        lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
        lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
        return;
    }

    // Build the menu from every task in the home. The id is the
    // taskHex so the activate callback can find the source row in
    // the model when the user taps.
    std::vector<domain::RoundMenuItem> items;
    items.reserve(all.size());
    for (const auto& t : all.items()) {
        domain::RoundMenuItem it;
        it.id = t.taskId.hex();
        it.title = t.title.empty() ? std::string{"(untitled)"} : t.title;
        it.subtitle = tierLabel(t.urgency, t.isMissed);
        // Only Urgent + missed get the destructive accent so the user
        // can spot what's actually overdue at a glance while spinning
        // through the carousel.
        it.destructive =
            (t.urgency == domain::Urgency::Urgent) || t.isMissed;
        items.push_back(std::move(it));
    }
    menuModel_.replace(std::move(items));
    menu_.build(root_, menuModel_);
    menu_.refresh();

    menu_.setOnActivate([this](const domain::RoundMenuItem& it) {
        // Find the matching task in the all-tasks model so we can
        // pull its result_type_id + occurrence_id (if any) into the
        // mark-done draft. The carousel id is the taskHex so a
        // straight match works.
        const auto& all = this->app().allTasks();
        const howler::domain::DashboardItem* match = nullptr;
        for (const auto& d : all.items()) {
            if (d.taskId.hex() == it.id) { match = &d; break; }
        }
        if (!match) return;
        auto& app = this->app();
        app.pendingDone() = {};
        app.pendingDone().taskId = match->taskId;
        app.pendingDone().occurrenceId = match->occurrenceId;
        app.pendingDone().resultTypeId = match->resultTypeId;
        app.router().push(match->resultTypeId.empty()
                          ? domain::ScreenId::UserPicker
                          : domain::ScreenId::ResultPicker);
    });
    menuActive_ = true;

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate · tap done · double back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

void ScreenManager::buildTaskDetail() {
    // Reserved for a future "row → detail" path. Today the All-tasks
    // and Dashboard screens go straight into the mark-done flow on
    // tap, so this screen exists only to satisfy the ScreenId enum.
    root_ = buildRoundBackground();
    auto* l = lv_label_create(root_);
    lv_label_set_text(l, "task detail\n(double back)");
    lv_obj_set_style_text_color(l, Palette::ink2(), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);
}

}  // namespace howler::screens
