// Settings menu — round-display carousel of action items. Tap on
// the centre item activates; double-tap pops back; long-press on a
// destructive item (Unpair) confirms via the perimeter arc.
//
// Each entry maps to a router transition. The activate callback
// switches on the item's `id` because std::function captures store
// poorly compared to id-based dispatch.

#include "ScreenManager.h"
#include "components/RoundCard.h"
#include "../application/PairCoordinator.h"
#include <stdio.h>

namespace howler::screens {

using components::Palette;
using components::buildRoundBackground;

namespace {

domain::RoundMenuItem mk(const char* id, const char* title,
                        const char* sub = "", bool dest = false) {
    domain::RoundMenuItem it;
    it.id = id;
    it.title = title;
    it.subtitle = sub;
    it.destructive = dest;
    return it;
}

}  // namespace

void ScreenManager::buildSettings() {
    root_ = buildRoundBackground();
    longPressArcWidget_.build(root_, Palette::accent());

    // Header chip.
    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "settings");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 12);
    }

    // Footer hint.
    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "tap pick · double back");
        lv_obj_set_style_text_color(h, Palette::ink3(), 0);
        lv_obj_align(h, LV_ALIGN_BOTTOM_MID, 0, -10);
    }

    menuModel_.replace({
        mk("all-tasks", "All tasks",   "browse + mark done"),
        mk("wifi",      "Wi-Fi",       "scan + connect"),
        mk("login-qr",  "Login by QR", "phone link"),
        mk("brightness","Brightness",  "screen level"),
        mk("about",     "About",       "device info"),
        mk("unpair",    "Unpair",      "hold to confirm", /*dest=*/true),
    });
    menu_.build(root_, menuModel_);
    menu_.refresh();

    menu_.setOnActivate([this](const domain::RoundMenuItem& it) {
        auto& app = this->app();
        const auto& id = it.id;
        if      (id == "all-tasks")  app.router().push(domain::ScreenId::TaskList);
        else if (id == "wifi")       app.router().push(domain::ScreenId::Wifi);
        else if (id == "login-qr")   app.router().push(domain::ScreenId::LoginQr);
        else if (id == "brightness") app.router().push(domain::ScreenId::SettingsBrightness);
        else if (id == "about")      app.router().push(domain::ScreenId::SettingsAbout);
        // 'unpair' is destructive — must be reached via long-press,
        // handled in ScreenManager::onEvent below. A bare tap is a
        // no-op so users can rotate past it without firing.
    });
    menuActive_ = true;
}

void ScreenManager::buildSettingsBrightness() {
    root_ = buildRoundBackground();

    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "Brightness");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 18);
    }

    auto* arc = lv_arc_create(root_);
    lv_obj_set_size(arc, 180, 180);
    lv_obj_center(arc);
    lv_arc_set_rotation(arc, 135);
    lv_arc_set_bg_angles(arc, 0, 270);
    lv_arc_set_range(arc, 16, 255);
    lv_arc_set_value(arc, app_.settings().brightness);
    lv_obj_remove_style(arc, nullptr, LV_PART_KNOB);
    lv_obj_set_style_arc_color(arc, Palette::lineSoft(), LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, Palette::accent(), LV_PART_INDICATOR);
    lv_obj_set_style_arc_width(arc, 8, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, 8, LV_PART_INDICATOR);
    if (group_) {
        lv_group_add_obj(group_, arc);
        lv_group_focus_obj(arc);
    }

    auto* val = lv_label_create(root_);
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", (unsigned)app_.settings().brightness);
    lv_label_set_text(val, buf);
    lv_obj_set_style_text_color(val, Palette::ink(), 0);
    lv_obj_set_style_text_font(val, &lv_font_montserrat_22, 0);
    lv_obj_center(val);

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate · double back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -12);

    lv_obj_add_event_cb(arc, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        const int v = lv_arc_get_value(lv_event_get_target_obj(e));
        mgr->app().settings().brightness = static_cast<uint8_t>(v);
    }, LV_EVENT_VALUE_CHANGED, this);
}

void ScreenManager::buildSettingsAbout() {
    root_ = buildRoundBackground();

    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "About");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 18);
    }

    auto* card = components::buildCenterCard(root_, 180, Palette::paper2());
    auto* l = lv_label_create(card);
    char buf[200];
    // Show only the last 8 hex chars of the device id — the leading
    // 24 are zero-padding, not interesting to read aloud.
    const auto& did = app_.deviceId();
    const std::string tail = did.size() >= 8
        ? did.substr(did.size() - 8) : did;
    snprintf(buf, sizeof(buf),
        "Howler\nfw 0.2.0\ndev %s\npending %u",
        tail.c_str(),
        (unsigned)app_.queue().size());
    lv_label_set_text(l, buf);
    lv_obj_set_style_text_color(l, Palette::ink(), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "double back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -12);
}

}  // namespace howler::screens
