// Wi-Fi list + connect screens. Scan happens on screen entry; the
// list is populated from `App::wifiScan()`. The user picks an SSID,
// the device pushes a "connecting" screen, calls
// `App::saveAndConnectWifi`, and pops back to Settings on success
// (or shows the error banner on failure).
//
// Password entry is rotary-keyboard simplified: we accept the
// SSID with empty creds for open networks; secured networks fall
// back to the legacy "open the SPA on your phone" flow until the
// rotary keyboard lands (plan §10.4 #5).

#include "ScreenManager.h"
#include <stdio.h>

namespace howler::screens {

void ScreenManager::buildWifi() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* title = lv_label_create(root_);
    lv_label_set_text(title, "Wi-Fi");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 4);

    // Lazy: refresh the scan when the screen first opens. Any later
    // visits use the cached list (rotary navigation is fast; another
    // scan takes seconds).
    if (app_.wifiScan().empty()) {
        app_.refreshWifiScan();
    }

    auto* list = lv_list_create(root_);
    lv_obj_set_size(list, LV_PCT(100), 180);
    lv_obj_align(list, LV_ALIGN_BOTTOM_MID, 0, 0);

    if (app_.wifiScan().empty()) {
        auto* none = lv_label_create(list);
        lv_label_set_text(none, "no networks found");
        return;
    }

    for (const auto& w : app_.wifiScan()) {
        const char* sym = w.secured ? LV_SYMBOL_KEYBOARD : LV_SYMBOL_WIFI;
        auto* btn = lv_list_add_btn(list, sym, w.ssid.c_str());
        if (group_) lv_group_add_obj(group_, btn);
        // Stash a copy of the SSID on the button so the click handler
        // can reach it without re-scanning.
        auto* idCopy = static_cast<char*>(lv_malloc(w.ssid.size() + 1));
        memcpy(idCopy, w.ssid.c_str(), w.ssid.size() + 1);
        lv_obj_set_user_data(btn, idCopy);
        lv_obj_add_event_cb(btn, [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
            auto* btn = lv_event_get_target_obj(e);
            const char* ssid = static_cast<const char*>(lv_obj_get_user_data(btn));
            // Open networks: connect immediately. Secured networks
            // need a password — currently we punt to the SPA pairing
            // flow so the rotary doesn't have to type a password yet.
            howler::domain::WifiConfig cfg;
            cfg.ssid = ssid ? ssid : "";
            mgr->app().saveAndConnectWifi(cfg);
            mgr->app().router().push(domain::ScreenId::WifiConnect);
        }, LV_EVENT_CLICKED, this);
    }
}

void ScreenManager::buildWifiConnect() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* l = lv_label_create(root_);
    if (app_.wifi().isConnected()) {
        char buf[80];
        snprintf(buf, sizeof(buf), "connected: %s", app_.wifi().currentSsid().c_str());
        lv_label_set_text(l, buf);
    } else {
        lv_label_set_text(l, "connecting...");
    }
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);
}

void ScreenManager::buildLoginQr() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* l = lv_label_create(root_);
    // The "login by QR" flow points the device at a webapp deep-link
    // including the device id. Scanning it on the user's phone (where
    // they're already logged in) lets them confirm the pair without
    // re-typing the 6-digit code.
    char url[96];
    snprintf(url, sizeof(url), "https://howler.app/pair?dev=%s",
        app_.deviceId().c_str());
#if LV_USE_QRCODE
    auto* qr = lv_qrcode_create(root_);
    lv_qrcode_set_size(qr, 140);
    lv_qrcode_set_dark_color(qr, lv_color_black());
    lv_qrcode_set_light_color(qr, lv_color_make(0xF6, 0xEF, 0xDC));
    lv_qrcode_update(qr, url, strlen(url));
    lv_obj_align(qr, LV_ALIGN_TOP_MID, 0, 8);
    lv_label_set_text(l, "scan to pair");
    lv_obj_align(l, LV_ALIGN_BOTTOM_MID, 0, -8);
#else
    lv_label_set_text(l, url);
    lv_obj_center(l);
#endif
}

}  // namespace howler::screens
