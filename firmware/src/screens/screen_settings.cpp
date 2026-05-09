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
#include "../application/Version.h"
#include <Arduino.h>
#include <esp_heap_caps.h>
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

    // Stash the centre-value label on the arc's user_data slot so
    // the change handler can repaint it as the user rotates. Same
    // pattern the SettingsTheme pills use to thread a per-pill
    // intent into the click handler — keeps state out of
    // ScreenManager's members and dies naturally when the arc
    // (and its child label) get deleted with root_ in teardown.
    // Previously the number froze at the entry-time value while
    // the arc visibly filled — a misleading mismatch that made
    // it look like the rotation wasn't registering.
    lv_obj_set_user_data(arc, val);

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "rotate | 2x back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -12);

    lv_obj_add_event_cb(arc, [](lv_event_t* e) {
        if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED) return;
        auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
        auto* arc = lv_event_get_target_obj(e);
        const int v = lv_arc_get_value(arc);
        mgr->app().settings().brightness = static_cast<uint8_t>(v);
        if (auto* lbl = static_cast<lv_obj_t*>(lv_obj_get_user_data(arc))) {
            char buf[16];
            snprintf(buf, sizeof(buf), "%u", (unsigned)v);
            lv_label_set_text(lbl, buf);
        }
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

// Helpers for the About screen — kept here (not exported) because
// they're only useful for the diagnostic readout below. Each one
// renders a single value into a fixed-size buffer the caller owns.

namespace {

// "Xh Ym" / "Ym Xs" / "Xs" — device uptime since power-on.
void formatUptime(char* buf, size_t cap, uint32_t millisNow) {
    const uint32_t secs = millisNow / 1000;
    const uint32_t mins = secs / 60;
    const uint32_t hrs  = mins / 60;
    if (hrs > 0)        snprintf(buf, cap, "%uh %um", hrs, mins % 60);
    else if (mins > 0)  snprintf(buf, cap, "%um %us", mins, secs % 60);
    else                snprintf(buf, cap, "%us", secs);
}

// "30s ago" / "5m ago" / "2h ago" / "—" if never synced.
void formatSyncAge(char* buf, size_t cap, int64_t lastSec, int64_t nowSec) {
    if (lastSec <= 0 || nowSec <= 0 || nowSec < lastSec) {
        snprintf(buf, cap, "—");
        return;
    }
    const int64_t age = nowSec - lastSec;
    if (age < 60)         snprintf(buf, cap, "%llds ago", (long long)age);
    else if (age < 3600)  snprintf(buf, cap, "%lldm ago", (long long)(age / 60));
    else                  snprintf(buf, cap, "%lldh ago", (long long)(age / 3600));
}

const char* networkHealthLabel(application::App::NetworkHealth h) {
    switch (h) {
        case application::App::NetworkHealth::Fresh:   return "online";
        case application::App::NetworkHealth::Stale:   return "stale";
        case application::App::NetworkHealth::Offline: return "offline";
    }
    return "?";
}

// Render the SSID + RSSI on a single line. Truncates the SSID to
// `kSsidCap` chars with a trailing '…' so the row stays inside the
// 188-px card no matter what the user named their AP. RSSI is shown
// in dBm; 0 means "not associated or unknown" and falls through to
// a bare SSID (or "—" when both are missing).
void formatWifiLine(char* buf, size_t cap, application::App& app) {
    const bool connected = app.wifi().isConnected();
    if (!connected) { snprintf(buf, cap, "—"); return; }

    constexpr size_t kSsidCap = 12;
    std::string ssid = app.wifi().currentSsid();
    if (ssid.size() > kSsidCap) {
        ssid.resize(kSsidCap - 1);
        ssid.push_back('~');  // ASCII fallback — montserrat_10 ships
                              // a narrow ellipsis but the visual hint
                              // is the same and avoids a glyph miss.
    }
    const int rssi = app.wifi().currentRssi();
    if (rssi == 0) { snprintf(buf, cap, "%s", ssid.c_str()); return; }
    snprintf(buf, cap, "%s %ddBm", ssid.c_str(), rssi);
}

// Format the multi-line diagnostic body into `buf`. Used by both
// `buildSettingsAbout` (initial render) and the per-second refresh
// in `ScreenManager::tick`, so a future field addition only touches
// one place. Pulled out of the build path so the live update doesn't
// duplicate the layout string.
void formatAboutBody(char* buf, size_t cap, application::App& app) {
    char ageBuf[24];
    char upBuf[24];
    char wifiBuf[40];
    formatSyncAge(ageBuf, sizeof(ageBuf),
                   app.lastFullSyncSec(),
                   app.clock().nowEpochSeconds());
    formatUptime(upBuf, sizeof(upBuf), millis());
    formatWifiLine(wifiBuf, sizeof(wifiBuf), app);

    const uint32_t heapBytes = heap_caps_get_free_size(MALLOC_CAP_DEFAULT);
    const uint32_t heapKB    = heapBytes / 1024;

    const auto& did = app.deviceId();
    const std::string didTail = did.size() >= 8
        ? did.substr(did.size() - 8) : did;

    // IP is shown as a separate row when associated so the user can
    // verify "yes, DHCP completed" — most "wifi connected but sync
    // broken" investigations land here. Empty when not connected.
    const std::string ip = app.wifi().currentIp();
    const char* ipStr = ip.empty() ? "—" : ip.c_str();

    // 8 rows fit the 158-px card with the 10pt body font + 2 px
    // line-space (~118 px content area). Order groups related
    // diagnostics: connectivity (net / wifi / ip / sync), then host
    // health (ram / up / queue), then identity. The `theme` row from
    // dev-27 was retired here — the active theme is already visible
    // at a glance from the screen's own background, so the slot is
    // better spent on `ip`, which is the data point the user
    // actually needs when debugging "wifi connected but sync broken".
    snprintf(buf, cap,
             "net    %s\n"
             "wifi   %s\n"
             "ip     %s\n"
             "sync   %s\n"
             "ram    %u KB\n"
             "up     %s\n"
             "queue  %u pending\n"
             "dev    %s",
             networkHealthLabel(app.networkHealth()),
             wifiBuf,
             ipStr,
             ageBuf,
             static_cast<unsigned>(heapKB),
             upBuf,
             static_cast<unsigned>(app.queue().size()),
             didTail.c_str());
}

}  // namespace

void ScreenManager::buildSettingsAbout() {
    root_ = buildRoundBackground();

    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "About");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_set_style_text_font(h, &lv_font_montserrat_14, 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 14);
    }

    // Centre card — slightly taller than the legacy 180-px disc so
    // the multi-line readout doesn't crowd the rim. Width matches
    // the dashboard's detail card so the visual rhythm is consistent
    // across the Settings sub-screens.
    auto* card = lv_obj_create(root_);
    lv_obj_set_size(card, 188, 158);
    lv_obj_align(card, LV_ALIGN_CENTER, 0, 6);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(card, 14, 0);
    lv_obj_set_style_bg_color(card, Palette::paper2(), 0);
    lv_obj_set_style_border_color(card, Palette::lineSoft(), 0);
    lv_obj_set_style_border_width(card, 1, 0);
    lv_obj_set_style_pad_all(card, 10, 0);

    // Title row — firmware name + version. Centred.
    {
        char title[40];
        snprintf(title, sizeof(title), "Howler · fw %s",
                 application::kFirmwareVersion);
        auto* l = lv_label_create(card);
        lv_label_set_text(l, title);
        lv_obj_set_style_text_color(l, Palette::ink(), 0);
        lv_obj_set_style_text_font(l, &lv_font_montserrat_12, 0);
        lv_obj_align(l, LV_ALIGN_TOP_MID, 0, 0);
    }

    // Hairline separator under the title — purely cosmetic, gives
    // the multi-line readout below a clear break from the heading.
    {
        auto* line = lv_obj_create(card);
        lv_obj_set_size(line, 140, 1);
        lv_obj_align(line, LV_ALIGN_TOP_MID, 0, 16);
        lv_obj_clear_flag(line, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_clear_flag(line, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_bg_color(line, Palette::lineSoft(), 0);
        lv_obj_set_style_border_width(line, 0, 0);
        lv_obj_set_style_pad_all(line, 0, 0);
    }

    // Body — one big multi-line label with all the diagnostics. We
    // build it as a single label (not 6 separate labels) so the
    // line-spacing stays uniform and a small font swap touches one
    // place. Same `formatAboutBody` runs from `tick()` once a
    // second so live values (sync age, uptime, ram, queue) keep
    // ticking up while the user reads the screen.
    char body[256];
    formatAboutBody(body, sizeof(body), app_);

    auto* l = lv_label_create(card);
    lv_label_set_text(l, body);
    lv_obj_set_style_text_color(l, Palette::ink(), 0);
    lv_obj_set_style_text_font(l, &lv_font_montserrat_10, 0);
    lv_obj_set_style_text_line_space(l, 2, 0);
    lv_obj_align(l, LV_ALIGN_TOP_LEFT, 4, 22);

    // Hand the label pointer to ScreenManager so the live-update
    // tick can repaint it in place. The first refresh is scheduled
    // ~1 s from now — earlier than that and the user would see the
    // text flash on entry from a value that's already correct.
    aboutBodyLabel_       = l;
    aboutNextRefreshMs_   = millis() + 1000;

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "2x back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_set_style_text_font(hint, &lv_font_montserrat_10, 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -8);
}

void ScreenManager::refreshSettingsAbout() {
    if (!aboutBodyLabel_) return;
    char body[256];
    formatAboutBody(body, sizeof(body), app_);
    lv_label_set_text(aboutBodyLabel_, body);
}

}  // namespace howler::screens
