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

    // Tab strip — Settings is the third main pill. Knob and
    // horizontal swipe at root cycle between Today / All / Menu.
    {
        components::TabStripEntry entries[] = {
            {"today"}, {"all"}, {"menu"},
        };
        components::buildTabStrip(root_, entries, 3, /*activeIndex=*/2);
    }

    // Footer hint reminds users that vertical swipe / tap drives
    // the carousel below — knob rotation cycles main pills here.
    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "swipe up/down | tap pick");
        lv_obj_set_style_text_color(h, Palette::ink3(), 0);
        lv_obj_align(h, LV_ALIGN_BOTTOM_MID, 0, -10);
    }

    // 'Switch view' dropped — main-screen switching is now a
    // first-class swipe gesture, no menu detour needed.
    const bool isDark = app_.settings().theme == domain::Theme::Dark;
    menuModel_.replace({
        mk("sync",      "Sync now",    "fetch latest"),
        mk("theme",     "Theme",       isDark ? "dark | tap to flip"
                                              : "light | tap to flip"),
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
        if (id == "sync") {
            // Force a sync round on the next tick. The toast gives
            // visible feedback even when the network round-trip is
            // fast.
            app.sync().requestSync();
            this->showToast("syncing...", 1500);
        }
        else if (id == "theme") {
            // Push the dedicated Theme switcher screen so the user
            // sees the choice (Light vs Dark) explicitly. The flip-
            // in-place toggle previous versions used had no visible
            // UI when tapped — the user couldn't tell anything had
            // happened.
            app.router().push(domain::ScreenId::SettingsTheme);
        }
        else if (id == "wifi")       app.router().push(domain::ScreenId::Wifi);
        else if (id == "login-qr")   app.router().push(domain::ScreenId::LoginQr);
        else if (id == "brightness") app.router().push(domain::ScreenId::SettingsBrightness);
        else if (id == "about")      app.router().push(domain::ScreenId::SettingsAbout);
        // 'unpair' is destructive — must be reached via long-press,
        // handled in ScreenManager::onEvent. A bare tap is a no-op
        // so users can rotate past it without firing.
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
    lv_label_set_text(hint, "rotate | 2x back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -12);

    lv_obj_add_event_cb(arc, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        const int v = lv_arc_get_value(lv_event_get_target_obj(e));
        mgr->app().settings().brightness = static_cast<uint8_t>(v);
    }, LV_EVENT_VALUE_CHANGED, this);
}

void ScreenManager::buildSettingsTheme() {
    root_ = buildRoundBackground();

    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "Theme");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 18);
    }

    const bool isDark = app_.settings().theme == domain::Theme::Dark;

    // Two pills, side by side. Each pill PREVIEWS its own theme so
    // the user can read the choice at a glance — the Light pill is
    // always paper-toned with ink text, the Dark pill is always
    // ink-toned with paper text, regardless of which one is the
    // current selection. The active one is signalled by a thicker
    // accent border (won't fight the preview colours).
    //
    // Inverted-colour palette inside each pill: Light's bg + text
    // are the *light theme's* paper + ink (#F6EFDC + #1A1409 — same
    // hex tokens used by the screen palette), Dark's are the *dark
    // theme's* (#1A1409 + #F6EFDC). These are baked here rather
    // than read from the active Palette because the screen needs
    // the inactive theme's colours visible too.
    struct PillSpec {
        const char* label;
        domain::Theme value;
        lv_color_t bg;
        lv_color_t fg;
    };
    const PillSpec specs[2] = {
        {"Light", domain::Theme::Light,
         lv_color_make(0xF6, 0xEF, 0xDC),
         lv_color_make(0x1A, 0x14, 0x09)},
        {"Dark",  domain::Theme::Dark,
         lv_color_make(0x1A, 0x14, 0x09),
         lv_color_make(0xF6, 0xEF, 0xDC)},
    };

    for (int i = 0; i < 2; ++i) {
        const bool active = specs[i].value == app_.settings().theme;
        auto* btn = lv_btn_create(root_);
        lv_obj_set_size(btn, 86, 64);
        const int x = (i == 0) ? -50 : 50;
        lv_obj_align(btn, LV_ALIGN_CENTER, x, 0);
        lv_obj_set_style_radius(btn, 18, 0);
        lv_obj_set_style_shadow_width(btn, 0, 0);
        // Active = thick accent border, inactive = thin neutral.
        lv_obj_set_style_border_width(btn, active ? 3 : 1, 0);
        lv_obj_set_style_border_color(btn,
            active ? Palette::accent() : Palette::lineSoft(), 0);
        lv_obj_set_style_bg_color(btn, specs[i].bg, 0);

        auto* l = lv_label_create(btn);
        lv_label_set_text(l, specs[i].label);
        lv_obj_set_style_text_color(l, specs[i].fg, 0);
        lv_obj_set_style_text_font(l, &lv_font_montserrat_18, 0);
        lv_obj_center(l);

        // Stash the pill's theme value as user data so the click
        // handler can persist directly without recomputing index.
        lv_obj_set_user_data(btn, (void*)(intptr_t)
            (specs[i].value == domain::Theme::Dark ? 1 : 0));
        lv_obj_add_event_cb(btn, [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
            auto* btn = lv_event_get_target_obj(e);
            const intptr_t darkIntent = (intptr_t)lv_obj_get_user_data(btn);
            mgr->app().setTheme(darkIntent != 0
                ? domain::Theme::Dark
                : domain::Theme::Light);
            mgr->requestRebuild();
            mgr->app().router().pop();
        }, LV_EVENT_CLICKED, this);

        if (group_) {
            lv_group_add_obj(group_, btn);
            // Focus the OPPOSITE of the current theme so a knob
            // press flips it; tapping the touch screen still works
            // either way because the click handler is bound per-pill.
            if (!active) lv_group_focus_obj(btn);
        }
    }

    // Hint at the bottom: short enough to fit the round display
    // viewport without clipping. The previous "rotate | tap pick |
    // 2x back" string was wider than the disc radius and got
    // chopped (visible as "I tap pick | doubl..." in the photo).
    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, isDark ? "now: dark" : "now: light");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -28);

    auto* hint2 = lv_label_create(root_);
    lv_label_set_text(hint2, "tap pick | 2x back");
    lv_obj_set_style_text_color(hint2, Palette::ink3(), 0);
    lv_obj_align(hint2, LV_ALIGN_BOTTOM_MID, 0, -10);
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
    lv_label_set_text(hint, "2x back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -12);
}

}  // namespace howler::screens
