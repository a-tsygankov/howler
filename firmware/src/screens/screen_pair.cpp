#include "ScreenManager.h"
#include <stdio.h>

#if LV_USE_QRCODE
#include "libs/qrcode/lv_qrcode.h"
#endif

namespace howler::screens {

void ScreenManager::buildPair() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(root_, lv_color_make(0xF6, 0xEF, 0xDC), 0);
    lv_obj_set_layout(root_, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(root_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    auto& state = app_.pair().state();
    using domain::PairPhase;

#if LV_USE_QRCODE
    if (state.phase == PairPhase::Started || state.phase == PairPhase::Pending) {
        // Encode the SPA URL with the pair code as a query param.
        // The dashboard's PairTile reads ?pair=CODE on mount and
        // pre-fills the input — user lands logged-in on their phone,
        // taps Pair, done. Fall-back if they're not logged in: the
        // landing screen still has a manual "Pair a new dial" tile.
        char url[128];
        snprintf(url, sizeof(url),
            "https://howler-webapp.pages.dev/?pair=%s", state.pairCode.c_str());
        auto* qr = lv_qrcode_create(root_);
        lv_qrcode_set_size(qr, 120);
        lv_qrcode_set_dark_color(qr, lv_color_black());
        lv_qrcode_set_light_color(qr, lv_color_make(0xF6, 0xEF, 0xDC));
        lv_qrcode_update(qr, url, strlen(url));
    }
#endif

    auto* code = lv_label_create(root_);
    if (state.pairCode.empty()) {
        // No code yet — either we're between attempts or pair-start
        // failed. The status label below carries the explanation;
        // ASCII placeholder keeps the layout stable across font sets
        // (default Montserrat 14 doesn't include em-dash / ellipsis).
        lv_label_set_text(code, "------");
    } else {
        // Render as "123 456" — easier to read aloud.
        char fmt[16];
        snprintf(fmt, sizeof(fmt), "%c%c%c %c%c%c",
            state.pairCode[0], state.pairCode[1], state.pairCode[2],
            state.pairCode[3], state.pairCode[4], state.pairCode[5]);
        lv_label_set_text(code, fmt);
    }
    lv_obj_set_style_text_font(code, &lv_font_montserrat_22, 0);

    auto* status = lv_label_create(root_);
    lv_label_set_long_mode(status, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(status, 200);
    lv_obj_set_style_text_align(status, LV_TEXT_ALIGN_CENTER, 0);
    switch (state.phase) {
        case PairPhase::Started:   lv_label_set_text(status, "scan QR or enter code"); break;
        case PairPhase::Pending:   lv_label_set_text(status, "waiting for confirm..."); break;
        case PairPhase::Confirmed: lv_label_set_text(status, "paired!"); break;
        case PairPhase::Expired:   lv_label_set_text(status, "code expired - retrying"); break;
        case PairPhase::Cancelled: lv_label_set_text(status, "cancelled"); break;
        case PairPhase::Failed:    lv_label_set_text(status, "no wifi - tap to set up"); break;
        case PairPhase::Idle:      lv_label_set_text(status, "starting..."); break;
    }
    lv_obj_set_style_text_color(status, lv_color_make(0x7A, 0x70, 0x60), 0);
}

}  // namespace howler::screens
