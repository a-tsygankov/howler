// Polished Dashboard. Round-display-first layout with a drum-style
// task carousel: the selected task renders detailed in the centre,
// previous / next items render as mini pills above / below. Knob +
// vertical swipe spin the drum; horizontal swipe cycles main pills.
//
// Per the user spec 2026-05-08:
//   "Show selected task large with details and icon, others (from
//    dashboard — missed or coming up or urgent) show as mini
//    versions without details and allow to use vertical swipe (and
//    rotary) to navigate between them all."
//
// Dev-22 update: the static three-up layout was replaced with a
// DrumScroller so neighbour transitions slide smoothly with an
// ease-out animation, and inertial flicks scroll multiple tasks at
// once with deceleration (iPhone-style). The chrome around the drum
// (tab strip, tier counts header, cursor dots, footer hint) stays
// fixed across cursor changes — only the drum itself animates.
//
// Layout (top to bottom on the 240×240 disc):
//   y=18-44   tab strip (today | all | menu)
//   y=50-68   tier counts header (urgent / soon / later)
//   y=70-200  drum carousel (centre + ±1 neighbours)
//   y=205-220 cursor dots (#-position)
//   y=222-228 footer hint
//   perimeter long-press arc (hidden when not held)

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

    // Drum carousel for the task list. Per the design handoff the
    // selected detail card sits centred, with up to 3 mini rows
    // above and below progressively narrower / dimmer / overlapped.
    // We push that geometry into DrumScroller via per-distance
    // TierLayouts; the drum's slide animation + inertial swipe
    // path comes for free from the shared component.
    const size_t n = dash.size();
    const auto& items = dash.items();
    const int64_t serverNow = lastServerNowSec_;

    // Disc inner safe area is roughly 200 × 200 (~20 px from each
    // rim). The drum container sits inside that; per-tier widths
    // shrink from the centre's full width down by 8 / 18 / 28 px on
    // each side at distances 1 / 2 / 3.
    constexpr int kDrumW    = 204;   // ~ disc safe width
    constexpr int kDrumH    = 220;   // taller than wide so far tiers fit
    constexpr int kDetailW  = 204;
    constexpr int kDetailH  = 64;    // detail card visual is 58 px;
                                     // slot a bit taller for breathing
    constexpr int kMiniH    = 30;    // mini row visual is 26 px
    taskDrum_.build(root_, kDrumW, kDrumH, /*tierSpacing=*/56);
    using L = components::DrumScroller::TierLayout;
    // Distance 0 — the detail card.
    taskDrum_.setTierLayoutByDistance(0,
        L{0, kDetailW, kDetailH, LV_OPA_COVER});
    // Distance 1 — closest neighbour: 8 px inset each side, no
    // overlap, full opacity. y = 48 puts the mini's top 6 px below
    // the detail card's bottom edge.
    taskDrum_.setTierLayoutByDistance(1,
        L{48, kDetailW - 16, kMiniH, LV_OPA_COVER});
    // Distance 2 — 18 px inset, 7 px overlap with distance 1
    // (handled visually by the overlap math: y_step = miniH - 7).
    taskDrum_.setTierLayoutByDistance(2,
        L{48 + (kMiniH - 7), kDetailW - 36, kMiniH, LV_OPA_90});
    // Distance 3 — 28 px inset, 13 px overlap with distance 2.
    taskDrum_.setTierLayoutByDistance(3,
        L{48 + (kMiniH - 7) + (kMiniH - 13),
          kDetailW - 56, kMiniH, LV_OPA_70});

    taskDrum_.setItemCount(n);
    taskDrum_.setCursor(dash.cursor());
    // Render closure pulls each tier's item from the dashboard's
    // model. We capture by reference because the screen rebuilds
    // whenever the dashboard model is replaced — at which point the
    // drum is reconstructed too, so the reference doesn't outlive
    // its lifetime.
    taskDrum_.setRender([this, &items, serverNow](
        lv_obj_t* slot, size_t idx, int tier) {
        if (idx >= items.size()) return;
        renderTaskInDrumSlot(slot, items[idx], tier, serverNow);
    });
    taskDrumActive_ = true;

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

    // Cursor dots — which position in the list we're on. Stored as
    // a member so the drum's scroll handler can refresh them in place
    // without rebuilding the surrounding chrome.
    {
        auto* d = lv_label_create(root_);
        lv_obj_set_style_text_color(d, Palette::ink3(), 0);
        lv_obj_align(d, LV_ALIGN_BOTTOM_MID, 0, -28);
        taskCursorDots_ = d;
        updateDrumCursorDots(d, n, dash.cursor());
    }

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "tap done | hold confirm");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

}  // namespace howler::screens
