// All-tasks screen — same drum-style three-up layout as Dashboard,
// just driven by `app.allTasks()` (every active task in the home,
// not the urgency-filtered subset). Per the user spec 2026-05-08:
//
//   "show at least 3 tasks at once: 1 selected with details, and 2
//    others (if exist) as mini versions higher or lower or both
//    higher or both lower (depending on place in list). Detailed
//    view should have Icon."
//
// Knob rotation + vertical swipe spin the drum; tap on the centre
// task enters the standard mark-done flow (ResultPicker if the task
// has a result type, else UserPicker). Double-tap goes back to
// Dashboard via the universal pop. Long-press = quick mark-done with
// no result + no user attribution, same shortcut as Dashboard.
//
// Dev-22: drum carousel + inertial swipe match the Dashboard. The
// only structural difference between the two screens is which model
// they pull items from + which tab pill is highlighted.

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
using components::countTiers;
using components::updateDrumCursorDots;

void ScreenManager::buildTaskList() {
    root_ = buildRoundBackground();
    longPressArcWidget_.build(root_, Palette::accent());

    // Tab strip — same shape as Dashboard so the user always sees
    // every main screen available regardless of which is active.
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

    // Drum carousel — same per-distance layout as Dashboard so the
    // two screens read as variations of one design rather than
    // independent layouts. See screen_dashboard.cpp for the rationale
    // behind each y-offset / inset / opacity pick.
    constexpr int kDrumW   = 204;
    constexpr int kDrumH   = 220;
    constexpr int kDetailW = 204;
    constexpr int kDetailH = 64;
    constexpr int kMiniH   = 30;
    taskDrum_.build(root_, kDrumW, kDrumH, /*tierSpacing=*/56);
    using L = components::DrumScroller::TierLayout;
    taskDrum_.setTierLayoutByDistance(0,
        L{0, kDetailW, kDetailH, LV_OPA_COVER});
    taskDrum_.setTierLayoutByDistance(1,
        L{48, kDetailW - 16, kMiniH, LV_OPA_COVER});
    taskDrum_.setTierLayoutByDistance(2,
        L{48 + (kMiniH - 7), kDetailW - 36, kMiniH, LV_OPA_90});
    taskDrum_.setTierLayoutByDistance(3,
        L{48 + (kMiniH - 7) + (kMiniH - 13),
          kDetailW - 56, kMiniH, LV_OPA_70});
    taskDrum_.setItemCount(n);
    taskDrum_.setCursor(all.cursor());
    taskDrum_.setRender([this, &items, serverNow](
        lv_obj_t* slot, size_t idx, int tier) {
        if (idx >= items.size()) return;
        renderTaskInDrumSlot(slot, items[idx], tier, serverNow);
    });
    taskDrumActive_ = true;

    // Tier counts row at the very top under the tab strip.
    {
        const auto counts = countTiers(items);
        auto* row = lv_obj_create(root_);
        lv_obj_set_size(row, 168, 18);
        lv_obj_align(row, LV_ALIGN_TOP_MID, 0, 50);
        lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_bg_opa(row, LV_OPA_0, 0);
        lv_obj_set_style_border_width(row, 0, 0);
        lv_obj_set_style_pad_all(row, 0, 0);
        lv_obj_set_layout(row, LV_LAYOUT_FLEX);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

        struct Tier { size_t count; lv_color_t accent; const char* label; };
        const Tier tiers[] = {
            {counts.urgent, Palette::accent(), "urgent"},
            {counts.soon,   Palette::warn(),   "soon"},
            {counts.hidden, Palette::ink3(),   "later"},
        };
        for (const auto& t : tiers) {
            if (t.count == 0) continue;
            auto* l = lv_label_create(row);
            char buf[24];
            snprintf(buf, sizeof(buf), "%u %s", (unsigned)t.count, t.label);
            lv_label_set_text(l, buf);
            lv_obj_set_style_text_color(l, t.accent, 0);
            lv_obj_set_style_pad_right(l, 8, 0);
        }
    }

    // Cursor dots — kept in a member so onEvent can repaint without
    // rebuilding the whole screen.
    {
        auto* d = lv_label_create(root_);
        lv_obj_set_style_text_color(d, Palette::ink3(), 0);
        lv_obj_align(d, LV_ALIGN_BOTTOM_MID, 0, -28);
        taskCursorDots_ = d;
        updateDrumCursorDots(d, n, all.cursor());
    }

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "tap done | hold confirm");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
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
