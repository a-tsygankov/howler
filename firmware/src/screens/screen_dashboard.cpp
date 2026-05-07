#include "ScreenManager.h"
#include <stdio.h>

namespace howler::screens {

namespace {

lv_color_t kPaper      = lv_color_make(0xF6, 0xEF, 0xDC);
lv_color_t kInk        = lv_color_make(0x1A, 0x14, 0x09);
lv_color_t kInk2       = lv_color_make(0x57, 0x4E, 0x3E);
lv_color_t kAccent     = lv_color_make(0xC1, 0x3D, 0x1E);  // Urgent border

}  // namespace

void ScreenManager::buildDashboard() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(root_, kPaper, 0);
    lv_obj_set_style_pad_all(root_, 8, 0);

    auto& dash = app_.dashboard();

    // ── Header: urgent count + sync indicator ──────────────────
    auto* header = lv_label_create(root_);
    char hdr[64];
    if (dash.empty()) {
        snprintf(hdr, sizeof(hdr), "all clear");
    } else {
        const auto urg = dash.urgentCount();
        const auto rest = dash.size() - urg;
        snprintf(hdr, sizeof(hdr), "%u urgent  %u other",
            (unsigned)urg, (unsigned)rest);
    }
    lv_label_set_text(header, hdr);
    lv_obj_set_style_text_color(header, kInk2, 0);
    lv_obj_align(header, LV_ALIGN_TOP_MID, 0, 4);

    // ── Big card: the currently-selected item ──────────────────
    if (dash.empty()) {
        auto* empty = lv_label_create(root_);
        lv_label_set_text(empty, "no tasks today");
        lv_obj_set_style_text_color(empty, kInk2, 0);
        lv_obj_center(empty);
        return;
    }

    const auto* sel = dash.selected();
    auto* card = lv_obj_create(root_);
    lv_obj_set_size(card, 200, 130);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(card, 16, 0);
    lv_obj_set_style_bg_color(card, lv_color_white(), 0);
    lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_border_width(card,
        sel->urgency == domain::Urgency::Urgent ? 3 : 1, 0);
    lv_obj_set_style_border_color(card,
        sel->urgency == domain::Urgency::Urgent ? kAccent : kInk2, 0);

    auto* title = lv_label_create(card);
    lv_label_set_text(title, sel->title.empty() ? "(untitled)" : sel->title.c_str());
    lv_label_set_long_mode(title, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(title, 180);
    lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(title, kInk, 0);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 8);

    auto* sub = lv_label_create(card);
    char subtxt[64];
    if (sel->isMissed) {
        snprintf(subtxt, sizeof(subtxt), "MISSED");
    } else if (sel->dueAt < 0) {
        snprintf(subtxt, sizeof(subtxt), "no time");
    } else {
        snprintf(subtxt, sizeof(subtxt), "due %lld", (long long)sel->dueAt);
    }
    lv_label_set_text(sub, subtxt);
    lv_obj_set_style_text_color(sub, kInk2, 0);
    lv_obj_align(sub, LV_ALIGN_BOTTOM_MID, 0, -28);

    // Footer: "press to mark done"
    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "press: done   long-press: settings");
    lv_obj_set_style_text_color(hint, kInk2, 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -4);

    // ── Cursor dots ────────────────────────────────────────────
    {
        const size_t total = dash.size();
        const size_t cur = dash.cursor();
        char dots[64] = {0};
        size_t off = 0;
        for (size_t i = 0; i < total && off < sizeof(dots) - 4; ++i) {
            dots[off++] = (i == cur) ? '*' : '.';
            dots[off++] = ' ';
        }
        auto* d = lv_label_create(root_);
        lv_label_set_text(d, dots);
        lv_obj_set_style_text_color(d, kInk2, 0);
        lv_obj_align(d, LV_ALIGN_BOTTOM_MID, 0, -22);
    }
}

}  // namespace howler::screens
