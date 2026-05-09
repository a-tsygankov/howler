// Polished Dashboard — drum-style task carousel matching the design
// handoff in docs/design_handoff_howler/. The selected task renders
// in a 58 px detail card centred on the disc; the previous + next
// items render as 26 px mini pills above / below at progressively
// smaller widths and dimmer opacities (the "peek-stack" depth cue).
//
// Layout per the handoff (top → bottom on the 240×240 disc):
//   y=14   tab strip (today | all | menu)
//   y=46   detail card OR peek-stack-above-detail (selected first)
//   ...    drum carousel (centre + ±2 minis)
//   right rim: vertical scroll-position indicator (3 px dots, active
//              dot is 10 px tall, x ≈ 226)
//
// Knob rotation + vertical swipe spin the drum (with inertial
// magnitude on touch swipes); horizontal swipe cycles main pills;
// tap on the detail card enters mark-done.

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

    // Drum carousel. Per the user spec: at most 5 elements visible
    // (centre + ±1 + ±2). Distance 2 sits ~7 px overlapped with
    // distance 1 to give the design's "closer card hides the top of
    // the farther one" peek effect; opacity fades to 0.90 at d=2.
    const size_t n = dash.size();
    const auto& items = dash.items();
    const int64_t serverNow = lastServerNowSec_;

    constexpr int kDrumW    = 204;   // ~ disc safe width
    constexpr int kDrumH    = 220;
    constexpr int kDetailW  = 204;
    constexpr int kDetailH  = 44;    // detail card visual is 38 px
                                     // (dev-24: shrunk from 58)
    constexpr int kMiniH    = 28;    // mini row visual is 24 px
    // Closer mini sits 6 px below the detail card's bottom edge:
    //   detailH/2 + miniH/2 + 6 = 22 + 14 + 6 = 42
    constexpr int kMiniGap  = 42;
    taskDrum_.build(root_, kDrumW, kDrumH, /*tierSpacing=*/44);
    using L = components::DrumScroller::TierLayout;
    taskDrum_.setTierLayoutByDistance(0,
        L{0, kDetailW, kDetailH, LV_OPA_COVER});
    taskDrum_.setTierLayoutByDistance(1,
        L{kMiniGap, kDetailW - 16, kMiniH, LV_OPA_COVER});
    taskDrum_.setTierLayoutByDistance(2,
        L{kMiniGap + (kMiniH - 7), kDetailW - 36, kMiniH, LV_OPA_90});
    // dev-26: only render 3 cards total — centre + 1 above + 1
    // below. The ±2 silhouettes were visually busy (the user saw
    // them as overlap noise around the actual data) and the
    // 240×240 disc's vertical real estate is better spent on
    // breathing room around the centre detail card.
    taskDrum_.setMaxVisibleDistance(1);

    taskDrum_.setItemCount(n);
    taskDrum_.setCursor(dash.cursor());
    taskDrum_.setRender([this, &items, serverNow](
        lv_obj_t* slot, size_t idx, int tier) {
        if (idx >= items.size()) return;
        renderTaskInDrumSlot(slot, items[idx], tier, serverNow,
                             &iconLookup_);
    });
    taskDrumActive_ = true;

    // Right-rim scroll indicator — 3 px dots stacked vertically
    // at x ≈ -8 from the right edge, active dot drawn 10 px tall.
    taskCursorDots_ = buildDrumRimIndicator(root_, n, dash.cursor());

    // Bottom dot indicator (dev-26): tone-coloured dots summarising
    // the home's tier shape — terracotta for missed/urgent, amber
    // for soon. Up to 3 dots per tier; "+" beyond that. Stacks
    // above the OFFLINE/STALE badge when both are visible. Skip
    // when the tier counts are all zero so a healthy home shows
    // nothing rather than an empty row.
    {
        const auto counts = components::countTiers(items);
        if (counts.urgent + counts.soon > 0) {
            auto* dotRow = components::buildBottomDotIndicator(root_, counts);
            lv_obj_align(dotRow, LV_ALIGN_BOTTOM_MID, 0, -28);
        }
    }

    // Network-state badge: only rendered when the device is in
    // a degraded state (Stale or Offline). The buildNetworkBadge
    // helper returns nullptr for the empty-text branch so we can
    // skip it cheaply when everything's fresh.
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

}  // namespace howler::screens
