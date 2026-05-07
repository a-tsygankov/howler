#include "ScreenManager.h"
#include "../application/PairCoordinator.h"

namespace howler::screens {

namespace {

struct SettingsAction {
    const char* label;
    void (*onClick)(ScreenManager*);
};

void onWifi(ScreenManager* m)        { m->app().router().push(domain::ScreenId::Wifi); }
void onUnpair(ScreenManager* m) {
    application::PairCoordinator::clearToken(m->app().storage());
    m->app().router().replaceRoot(domain::ScreenId::Pair);
    m->app().pair().start(m->app().deviceId());
}
void onLoginQr(ScreenManager* m)     { m->app().router().push(domain::ScreenId::LoginQr); }
void onBrightness(ScreenManager* m)  { m->app().router().push(domain::ScreenId::SettingsBrightness); }
void onAbout(ScreenManager* m)       { m->app().router().push(domain::ScreenId::SettingsAbout); }

const SettingsAction kEntries[] = {
    {"Wi-Fi",        onWifi},
    {"Login by QR",  onLoginQr},
    {"Brightness",   onBrightness},
    {"Unpair",       onUnpair},
    {"About",        onAbout},
};

}  // namespace

void ScreenManager::buildSettings() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* list = lv_list_create(root_);
    lv_obj_set_size(list, LV_PCT(100), LV_PCT(100));
    for (const auto& e : kEntries) {
        auto* btn = lv_list_add_btn(list, LV_SYMBOL_RIGHT, e.label);
        if (group_) lv_group_add_obj(group_, btn);
        lv_obj_set_user_data(btn, (void*)e.onClick);
        lv_obj_add_event_cb(btn, [](lv_event_t* ev) {
            if (lv_event_get_code(ev) != LV_EVENT_CLICKED) return;
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(ev));
            auto fn = (void(*)(ScreenManager*))lv_obj_get_user_data(lv_event_get_target_obj(ev));
            if (fn) fn(mgr);
        }, LV_EVENT_CLICKED, this);
    }
}

void ScreenManager::buildSettingsBrightness() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* slider = lv_slider_create(root_);
    lv_obj_set_size(slider, 180, 20);
    lv_slider_set_range(slider, 16, 255);
    lv_slider_set_value(slider, app_.settings().brightness, LV_ANIM_OFF);
    lv_obj_center(slider);
    if (group_) {
        lv_group_add_obj(group_, slider);
        lv_group_focus_obj(slider);
    }

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate to set, long-press to back");
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);

    lv_obj_add_event_cb(slider, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        const int v = lv_slider_get_value(lv_event_get_target_obj(e));
        mgr->app().settings().brightness = static_cast<uint8_t>(v);
        // Persistence happens on screen exit (long-press) — see
        // ScreenManager::onEvent. Live preview only here.
    }, LV_EVENT_VALUE_CHANGED, this);
}

void ScreenManager::buildSettingsAbout() {
    root_ = lv_obj_create(lv_scr_act());
    lv_obj_set_size(root_, LV_PCT(100), LV_PCT(100));
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);

    auto* l = lv_label_create(root_);
    char buf[160];
    snprintf(buf, sizeof(buf), "Howler\ndev: %s\nfw: %s\npending: %u",
        app_.deviceId().c_str(),
        "0.1.0",
        (unsigned)app_.queue().size());
    lv_label_set_text(l, buf);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(l);
}

}  // namespace howler::screens
