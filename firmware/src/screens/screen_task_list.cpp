// All-tasks screen — same drum-style three-up layout as Dashboard,
// just driven by `app.allTasks()` (every active task in the home,
// not the urgency-filtered subset). Mirrors the design handoff
// layout exactly — the only structural difference between the two
// screens is which model they pull items from + which tab pill is
// highlighted.

#include "ScreenManager.h"
#include "components/DrumScroller.h"
#include "components/RoundCard.h"
#include "components/TaskCard.h"
#include "components/LongPressArcWidget.h"
#include <stdio.h>

namespace howler::screens {

using components::Palette;
using components::buildRoundBackground;
using components::buildCenterCard;
using components::buildDetailedTaskCard;
using components::buildMiniTaskCard;
using components::renderTaskInDrumSlot;
using components::buildDrumRimIndicator;
using components::updateDrumRimIndicator;

void ScreenManager::buildTaskList() {
    root_ = buildRoundBackground();
    longPressArcWidget_.build(root_, Palette::accent());

    {
        components::TabStripEntry entries[] = {
            {"today"}, {"all"}, {"menu"},
        };
        components::buildTabStrip(root_, entries, 3, /*activeIndex=*/1);
    }

    auto& all = app_.allTasks();
    if (all.empty()) {
        auto* card = buildCenterCard(root_, 180, Palette::paper2());
        auto* l = lv_label_create(card);
        lv_label_set_text(l, "no tasks yet");
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
        lv_obj_center(l);
        auto* hint = lv_label_create(root_);
        lv_label_set_text(hint, "2x back");
        lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
        lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
        return;
    }

    const size_t n = all.size();
    const auto& items = all.items();
    const int64_t serverNow = lastServerNowSec_;

    // Same TierLayouts as Dashboard so the two screens read as
    // variations of one design.
    constexpr int kDrumW    = 204;
    constexpr int kDrumH    = 220;
    constexpr int kDetailW  = 204;
    constexpr int kDetailH  = 44;
    constexpr int kMiniH    = 28;
    constexpr int kMiniGap  = 42;
    taskDrum_.build(root_, kDrumW, kDrumH, /*tierSpacing=*/44);
    using L = components::DrumScroller::TierLayout;
    taskDrum_.setTierLayoutByDistance(0,
        L{0, kDetailW, kDetailH, LV_OPA_COVER});
    taskDrum_.setTierLayoutByDistance(1,
        L{kMiniGap, kDetailW - 16, kMiniH, LV_OPA_COVER});
    taskDrum_.setTierLayoutByDistance(2,
        L{kMiniGap + (kMiniH - 7), kDetailW - 36, kMiniH, LV_OPA_90});
    taskDrum_.setMaxVisibleDistance(2);
    taskDrum_.setItemCount(n);
    taskDrum_.setCursor(all.cursor());
    taskDrum_.setRender([this, &items, serverNow](
        lv_obj_t* slot, size_t idx, int tier) {
        if (idx >= items.size()) return;
        renderTaskInDrumSlot(slot, items[idx], tier, serverNow,
                             &iconLookup_);
    });
    taskDrumActive_ = true;

    taskCursorDots_ = buildDrumRimIndicator(root_, n, all.cursor());

    // Same network-health badge as the Dashboard — keeps the offline
    // cue consistent across the two task-list screens.
    switch (app_.networkHealth()) {
        case application::App::NetworkHealth::Offline:
            components::buildNetworkBadge(root_, "OFFLINE",
                                          Palette::accent());
            break;
        case application::App::NetworkHealth::Stale:
            components::buildNetworkBadge(root_, "STALE",
                                          Palette::warn());
            break;
        case application::App::NetworkHealth::Fresh:
            break;
    }
}

void ScreenManager::buildTaskDetail() {
    // Reserved for a future "row → detail" path. Today both list
    // screens go straight into the mark-done flow on tap, so this
    // screen exists only to satisfy the ScreenId enum.
    root_ = buildRoundBackground();
    auto* l = lv_label_create(root_);
    lv_label_set_text(l, "task detail\n(2x back)");
    lv_obj_set_style_text_color(l, Palette::ink2(), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);
}

}  // namespace howler::screens
