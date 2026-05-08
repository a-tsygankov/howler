// Polished Dashboard. Round-display-first layout with reusable
// task-card components: the selected task renders detailed in the
// centre, and the previous / next dashboard items render as mini
// pills above / below so the user sees what's adjacent without
// scrolling. Knob + vertical swipe cycle through the items; the
// tab strip at the top names which main pill is active.
//
// Per the user spec 2026-05-08:
//   "Show selected task large with details and icon, others (from
//    dashboard — missed or coming up or urgent) show as mini
//    versions without details and allow to use vertical swipe (and
//    rotary) to navigate between them all."
//
// Layout (top to bottom on the 240×240 disc):
//   y=18-44   tab strip (today | all | menu)
//   y=48-78   mini pill: previous task (omitted at index 0)
//   y=82-178  detailed centre card for the selected task
//   y=182-212 mini pill: next task (omitted at last index)
//   y=212-228 footer hint
//   perimeter long-press arc (hidden when not held)

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

void ScreenManager::buildDashboard() {
    root_ = buildRoundBackground();

    auto& dash = app_.dashboard();

    // Perimeter arc — always built so the update loop can fade it
    // in/out without rebuilding the whole screen.
    longPressArcWidget_.build(root_, Palette::accent());

    // Tab strip (visual only — pills can't be tapped reliably on
    // the round display, so the user spec routes pill switching
    // exclusively through horizontal swipe).
    {
        components::TabStripEntry entries[] = {
            {"today"}, {"all"}, {"menu"},
        };
        components::buildTabStrip(root_, entries, 3, /*activeIndex=*/0);
    }

    if (dash.empty()) {
        auto* card = buildCenterCard(root_, 180, Palette::paper2());
        auto* l = lv_label_create(card);
        lv_label_set_text(l, "all clear");
        lv_obj_set_style_text_color(l, Palette::ink(), 0);
        lv_obj_set_style_text_font(l, &lv_font_montserrat_22, 0);
        lv_obj_align(l, LV_ALIGN_CENTER, 0, -8);

        auto* hint = lv_label_create(card);
        lv_label_set_text(hint, "no tasks today");
        lv_obj_set_style_text_color(hint, Palette::ink2(), 0);
        lv_obj_align(hint, LV_ALIGN_CENTER, 0, 18);
        return;
    }

    // Mini pills for the previous / next items. Skip when at the
    // edges so we never render a card pointing at a non-existent
    // task. The DashboardModel cursor wraps in code; here we
    // intentionally don't show a "wrap" pill because that would
    // imply linear ordering when the model is actually circular —
    // the cursor dots at the bottom convey the wrap relationship.
    const size_t n = dash.size();
    const size_t cur = dash.cursor();
    const auto& items = dash.items();

    if (n > 1 && cur > 0) {
        buildMiniTaskCard(root_, items[cur - 1], /*yOffset=*/-72);
    }
    if (n > 1 && cur + 1 < n) {
        buildMiniTaskCard(root_, items[cur + 1], /*yOffset=*/72);
    }

    // The selected task fills the centre.
    buildDetailedTaskCard(root_, items[cur], lastServerNowSec_);

    // Tier counts row at the very top under the tab strip — tiny
    // dot + count for each non-empty tier. Gives the user a quick
    // "what's the day shape" without leaving the screen.
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

    // Cursor dots — which position in the list we're on.
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

}  // namespace howler::screens
