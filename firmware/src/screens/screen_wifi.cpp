// Wi-Fi list + connect + login-QR. The list uses the round menu so
// each SSID gets a centred-large rendering; rotation cycles, tap
// activates. Open networks connect immediately on activate; secured
// networks fall back to the captive-portal flow until the rotary
// keyboard lands.

#include "ScreenManager.h"
#include "components/RoundCard.h"

#if LV_USE_QRCODE
#include "libs/qrcode/lv_qrcode.h"
#endif

#include <stdio.h>

namespace howler::screens {

using components::Palette;
using components::buildRoundBackground;

void ScreenManager::buildWifi() {
    root_ = buildRoundBackground();

    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "Wi-Fi");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 12);
    }

    // Lazy first scan; cached afterwards.
    if (app_.wifiScan().empty()) {
        app_.refreshWifiScan();
    }

    if (app_.wifiScan().empty()) {
        auto* card = components::buildCenterCard(root_, 180, Palette::paper2());
        auto* l = lv_label_create(card);
        lv_label_set_text(l, "no networks found");
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
        lv_obj_center(l);
        auto* hint = lv_label_create(root_);
        lv_label_set_text(hint, "double back");
        lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
        lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
        return;
    }

    std::vector<domain::RoundMenuItem> items;
    items.reserve(app_.wifiScan().size());
    for (const auto& w : app_.wifiScan()) {
        domain::RoundMenuItem it;
        it.id = w.ssid;
        it.title = w.ssid;
        // Subtitle: signal level + lock status. Compact ASCII so the
        // default Montserrat 14 glyph set covers it.
        char sub[32];
        snprintf(sub, sizeof(sub), "%s  %d dBm",
                 w.secured ? "[lock]" : "[open]", (int)w.rssi);
        it.subtitle = sub;
        items.push_back(std::move(it));
    }
    menuModel_.replace(std::move(items));
    menu_.build(root_, menuModel_);
    menu_.refresh();
    menu_.setOnActivate([this](const domain::RoundMenuItem& it) {
        // Open networks connect immediately. Secured networks
        // currently still fall through (no rotary keyboard yet) —
        // App::saveAndConnectWifi accepts an empty secret and the
        // STA layer fails gracefully, returning the user to Wi-Fi.
        howler::domain::WifiConfig cfg;
        cfg.ssid = it.id;
        this->app().saveAndConnectWifi(cfg);
        this->app().router().push(domain::ScreenId::WifiConnect);
    });
    menuActive_ = true;

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate | tap connect | double back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

void ScreenManager::buildWifiConnect() {
    root_ = buildRoundBackground();

    auto* card = components::buildCenterCard(root_, 180, Palette::paper2());
    auto* l = lv_label_create(card);
    if (app_.wifi().isConnected()) {
        char buf[80];
        snprintf(buf, sizeof(buf), "connected\n%s", app_.wifi().currentSsid().c_str());
        lv_label_set_text(l, buf);
        lv_obj_set_style_text_color(l, Palette::success(), 0);
    } else {
        lv_label_set_text(l, "connecting...");
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
    }
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "double back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

void ScreenManager::buildLoginQr() {
    root_ = buildRoundBackground();

    char url[96];
    snprintf(url, sizeof(url), "https://howler-webapp.pages.dev/?pair=%s",
        app_.deviceId().c_str());

    auto* l = lv_label_create(root_);
#if LV_USE_QRCODE
    auto* qr = lv_qrcode_create(root_);
    lv_qrcode_set_size(qr, 140);
    lv_qrcode_set_dark_color(qr, lv_color_black());
    lv_qrcode_set_light_color(qr, Palette::paper());
    lv_qrcode_update(qr, url, strlen(url));
    lv_obj_align(qr, LV_ALIGN_TOP_MID, 0, 18);
    lv_label_set_text(l, "scan with phone");
    lv_obj_set_style_text_color(l, Palette::ink2(), 0);
    lv_obj_align(l, LV_ALIGN_BOTTOM_MID, 0, -16);
#else
    lv_label_set_text(l, url);
    lv_obj_set_style_text_color(l, Palette::ink2(), 0);
    lv_obj_center(l);
#endif
}

}  // namespace howler::screens
