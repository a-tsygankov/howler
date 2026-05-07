// Wi-Fi list + connect screens. The actual scan/connect uses an
// IWifi instance owned by main.cpp; for now we expose a minimal flow
// where the user picks an SSID and the connect screen shows status.
//
// Password entry is simplified: rotary keyboard is deferred (plan
// §10.4 #5). The screen surfaces a "no password" path for open
// networks; secured networks render an "open the SPA on your phone"
// hint that lets the user push creds via /api/devices/wifi.

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

    // We don't have an IWifi accessor on App — the wifi screens will
    // be filled in once the supplicant is wired through main.cpp.
    // For now: show the saved SSID (if any) and the current state.
    auto* status = lv_label_create(root_);
    char buf[80];
    snprintf(buf, sizeof(buf), "saved: %s\n(open SPA to set creds)",
        app_.settings().homeTz.empty() ? "none" : app_.settings().homeTz.c_str());
    lv_label_set_text(status, buf);
    lv_obj_set_style_text_align(status, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(status);
}

void ScreenManager::buildWifiConnect() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    auto* l = lv_label_create(root_);
    lv_label_set_text(l, "connecting...");
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
