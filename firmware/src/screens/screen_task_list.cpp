// All-tasks screen — same detailed + mini layout as Dashboard, just
// driven by `app.allTasks()` (every active task in the home, not the
// urgency-filtered subset). Per the user spec 2026-05-08:
//
//   "show at least 3 tasks at once: 1 selected with details, and 2
//    others (if exist) as mini versions higher or lower or both
//    higher or both lower (depending on place in list). Detailed
//    view should have Icon."
//
// Knob rotation + vertical swipe move the cursor; tap on the centre
// task enters the standard mark-done flow (ResultPicker if the task
// has a result type, else UserPicker). Double-tap goes back to
// Dashboard via the universal pop. Long-press = quick mark-done with
// no result + no user attribution, same shortcut as Dashboard.

#include "ScreenManager.h"
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
using components::countTiers;

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
        lv_label_set_text(hint, "double back");
        lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
        lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
        return;
    }

    // Three-up layout matches Dashboard: previous mini above the
    // centre, detailed centre card, next mini below. Edge handling
    // shows a single neighbour when at the start or end of the list
    // — but if there are only 2 items total we still want both
    // visible, so we always show whichever neighbour exists.
    const size_t n = all.size();
    const size_t cur = all.cursor();
    const auto& items = all.items();

    if (n > 1 && cur > 0) {
        buildMiniTaskCard(root_, items[cur - 1], /*yOffset=*/-72);
    }
    if (n > 1 && cur + 1 < n) {
        buildMiniTaskCard(root_, items[cur + 1], /*yOffset=*/72);
    }

    buildDetailedTaskCard(root_, items[cur], lastServerNowSec_);

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

    // Cursor dots.
    {
        char dots[64] = {0};
        size_t off = 0;
        const size_t cap = n > 12 ? 12 : n;
        for (size_t i = 0; i < cap && off < sizeof(dots) - 4; ++i) {
            dots[off++] = (i == cur) ? '#' : '-';
            dots[off++] = ' ';
        }
        if (n > cap && off < sizeof(dots) - 1) dots[off++] = '+';
        auto* d = lv_label_create(root_);
        lv_label_set_text(d, dots);
        lv_obj_set_style_text_color(d, Palette::ink3(), 0);
        lv_obj_align(d, LV_ALIGN_BOTTOM_MID, 0, -28);
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
    lv_label_set_text(l, "task detail\n(double back)");
    lv_obj_set_style_text_color(l, Palette::ink2(), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);
}

}  // namespace howler::screens
