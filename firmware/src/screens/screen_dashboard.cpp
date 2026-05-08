// Polished Dashboard. Round-display-first layout: paper background
// fills the disc; a circular content card sits centred; a thin
// hold-progress arc along the perimeter shows long-press fill.
//
// Layout (top to bottom on the screen):
//   - top arc / chips: counts ("3 urgent · 1 other") in a small chip
//     with the urgency-tier accent
//   - centre card: avatar dot + task title + due / missed status
//   - cursor dots: little row at the bottom showing position
//   - perimeter arc (hidden when not held): fills clockwise as the
//     user holds for confirm. Driven by the LongPressArc model that
//     ScreenManager updates each tick.

#include "ScreenManager.h"
#include "components/RoundCard.h"
#include "components/LongPressArcWidget.h"
#include <stdio.h>

namespace howler::screens {

using components::Palette;
using components::buildRoundBackground;
using components::buildCenterCard;
using components::LongPressArcWidget;

namespace {

const char* dueLabel(int64_t dueAt, int64_t serverNowSec, bool isMissed) {
    static char buf[32];
    if (isMissed) return "MISSED";
    if (dueAt < 0) return "no time set";
    int64_t now = serverNowSec > 0 ? serverNowSec : 0;
    if (now == 0) {
        snprintf(buf, sizeof(buf), "scheduled");
        return buf;
    }
    const int64_t delta = dueAt - now;
    const int64_t abs = delta < 0 ? -delta : delta;
    const int64_t hours = abs / 3600;
    const int64_t mins  = (abs / 60) % 60;
    if (delta < 0) {
        if (hours > 0) snprintf(buf, sizeof(buf), "overdue %lldh", (long long)hours);
        else           snprintf(buf, sizeof(buf), "overdue %lldm", (long long)mins);
    } else {
        if (hours > 0) snprintf(buf, sizeof(buf), "in %lldh %lldm",
                                (long long)hours, (long long)mins);
        else           snprintf(buf, sizeof(buf), "in %lldm", (long long)mins);
    }
    return buf;
}

}  // namespace

void ScreenManager::buildDashboard() {
    root_ = buildRoundBackground();

    auto& dash = app_.dashboard();

    // ── perimeter arc (hold-to-confirm visual). Always built so the
    //    update loop can fade it in/out without a rebuild. ──
    longPressArcWidget_.build(root_, Palette::accent());

    // ── tab strip: today / all / menu (visual only) ─────────────
    // Knob rotation OR horizontal swipe at root cycles between
    // these. The pills aren't tappable — too small to hit reliably
    // on the round display.
    {
        components::TabStripEntry entries[] = {
            {"today"}, {"all"}, {"menu"},
        };
        components::buildTabStrip(root_, entries, 3, /*activeIndex=*/0);
    }

    // ── empty state ────────────────────────────────────────────
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

    const auto* sel = dash.selected();
    const bool urgent = sel->urgency == domain::Urgency::Urgent;
    const lv_color_t accent = urgent ? Palette::accent() : Palette::ink2();

    // (Urgency-count chip removed: the tab strip occupies the top
    // band now, and the centre card + cursor dots already convey
    // selection + total-count without doubling up the same number.)
    (void)urgent;  // kept above for the centre-card border accent

    // ── centre circular card with the selected task ──
    auto* card = buildCenterCard(root_, 156, Palette::paper2());
    lv_obj_set_style_border_color(card, accent, 0);
    lv_obj_set_style_border_width(card, urgent ? 3 : 1, 0);

    // Title — the headline.
    auto* title = lv_label_create(card);
    lv_label_set_text(title, sel->title.empty() ? "(untitled)" : sel->title.c_str());
    lv_label_set_long_mode(title, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(title, 130);
    lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(title, Palette::ink(), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_18, 0);
    lv_obj_align(title, LV_ALIGN_CENTER, 0, -12);

    // Due / missed line.
    auto* sub = lv_label_create(card);
    lv_label_set_text(sub, dueLabel(sel->dueAt, lastServerNowSec_, sel->isMissed));
    lv_obj_set_style_text_color(sub,
        sel->isMissed ? Palette::accent() : Palette::ink2(), 0);
    lv_obj_align(sub, LV_ALIGN_CENTER, 0, 22);

    // ── footer hint ──
    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "tap: done    hold: confirm");
    lv_obj_set_style_text_color(hint, Palette::ink2(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);

    // ── cursor dots ──
    {
        const size_t total = dash.size();
        const size_t cur = dash.cursor();
        char dots[64] = {0};
        size_t off = 0;
        const size_t cap = total > 12 ? 12 : total;  // cap visual count
        for (size_t i = 0; i < cap && off < sizeof(dots) - 4; ++i) {
            // Use bullet (·) for inactive, bigger bullet (•) for active.
            // ASCII fallback for the default Montserrat 14 set.
            dots[off++] = (i == cur) ? '#' : '-';
            dots[off++] = ' ';
        }
        if (total > cap) {
            // overflow tail
            if (off < sizeof(dots) - 1) dots[off++] = '+';
        }
        auto* d = lv_label_create(root_);
        lv_label_set_text(d, dots);
        lv_obj_set_style_text_color(d, Palette::ink3(), 0);
        lv_obj_align(d, LV_ALIGN_BOTTOM_MID, 0, -28);
    }
}

}  // namespace howler::screens
