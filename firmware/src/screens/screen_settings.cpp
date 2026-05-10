// Settings menu — round-display carousel of action items. Tap on
// the centre item activates; double-tap pops back; long-press on a
// destructive item (Unpair) confirms via the perimeter arc.
//
// Each entry maps to a router transition. The activate callback
// switches on the item's `id` because std::function captures store
// poorly compared to id-based dispatch.

#include "ScreenManager.h"
#include "components/RoundCard.h"
#include "components/TaskCard.h"  // iconKeyFromAvatar + badgeTextForIcon
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
        // The "tap to flip" subtitle from the dev-22 carousel was a
        // lie — tapping pushes the SettingsTheme picker, doesn't
        // toggle in place. Show the current theme instead so the
        // text describes state (matching the "screen level" / "phone
        // link" / "device info" peers) rather than mis-describing
        // the tap action.
        mk("theme",     "Theme",       isDark ? "now: dark"
                                              : "now: light"),
        mk("wifi",      "Wi-Fi",       "scan + connect"),
        mk("login-qr",  "Login by QR", "phone link"),
        mk("brightness","Brightness",  "screen level"),
        // Phase 6 OTA F4 — Check for updates. Surfaces fwVersion
        // as the subtitle so the user can confirm at a glance which
        // build is running before tapping in.
        mk("updates",   "Updates",     application::kFirmwareVersion),
        mk("about",     "About",       "device info"),
        mk("unpair",    "Unpair",      "hold to confirm", /*dest=*/true),
    });
    menu_.build(root_, menuModel_);
    menu_.refresh();

    menu_.setOnActivate([this](const domain::RoundMenuItem& it) {
        auto& app = this->app();
        const auto& id = it.id;
        if (id == "sync") {
            // requestUserSync wraps the underlying requestSync()
            // call with the toast lifecycle — captures a baseline
            // watermark + a 6 s deadline so the in-flight
            // "syncing..." gets replaced by "synced" / "sync
            // failed" / "sync offline" once the round actually
            // resolves. Without that wrapper the toast just
            // expired after 1.5 s with no signal of outcome.
            this->requestUserSync();
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
        else if (id == "updates") {
            // Reset the OtaService so a re-entry after a previous
            // "UpToDate" or "Failed" doesn't show the stale banner;
            // the build path schedules a fresh check.
            app.ota().reset();
            app.router().push(domain::ScreenId::SettingsUpdates);
        }
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
//
// `failedSinceLastOk` flags the case where we've successfully
// synced before (so an age is meaningful) but the *most recent*
// attempt failed — append " · err" so the user gets the diagnostic
// before the data crosses the 120 s staleness threshold and the
// `net` row flips to STALE on its own. We don't surface err while
// offline; the `net` row already says "offline" in that case and
// duplicating it adds noise.
void formatSyncAge(char* buf, size_t cap, int64_t lastSec, int64_t nowSec,
                   bool failedSinceLastOk) {
    if (lastSec <= 0 || nowSec <= 0 || nowSec < lastSec) {
        snprintf(buf, cap, "—");
        return;
    }
    const int64_t age = nowSec - lastSec;
    const char* tail = failedSinceLastOk ? " err" : "";
    if (age < 60)         snprintf(buf, cap, "%llds ago%s", (long long)age, tail);
    else if (age < 3600)  snprintf(buf, cap, "%lldm ago%s", (long long)(age / 60), tail);
    else                  snprintf(buf, cap, "%lldh ago%s", (long long)(age / 3600), tail);
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
    // "err" only fires when we're online AND we've previously synced
    // — that's the case where the net row hasn't yet flipped to
    // STALE but the most recent attempt actually failed. While
    // offline, networkHealth() already reports Offline on the net
    // row, so the err marker would be redundant.
    const bool syncFailedSinceOk =
        app.network().isOnline() &&
        app.lastFullSyncSec() > 0 &&
        !app.sync().lastSyncOk();
    formatSyncAge(ageBuf, sizeof(ageBuf),
                   app.lastFullSyncSec(),
                   app.clock().nowEpochSeconds(),
                   syncFailedSinceOk);
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

    // Title row — home avatar + name on the left, firmware version
    // on the right. The avatar uses the same icon-cache lookup the
    // task drum uses; UUID avatars (uploaded photos) fall back to
    // initials, matching the device's "we don't render arbitrary
    // photos" stance. Falls back to "Howler" when home identity
    // hasn't synced yet (first boot before the four-fetch round
    // lands).
    {
        const auto& hi = app_.homeIdentity();

        // Home avatar disc — left edge, 22 px round. Same render
        // chain as RoundMenu's centre badge: icon: prefix → bitmap
        // via the IconCache, otherwise initials fallback.
        auto* disc = lv_obj_create(card);
        constexpr int kDiscSize = 22;
        lv_obj_set_size(disc, kDiscSize, kDiscSize);
        lv_obj_align(disc, LV_ALIGN_TOP_LEFT, 0, -2);
        lv_obj_clear_flag(disc, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_clear_flag(disc, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_radius(disc, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(disc, Palette::paper3(), 0);
        lv_obj_set_style_border_width(disc, 0, 0);
        lv_obj_set_style_pad_all(disc, 0, 0);

        const char* iconKey = components::iconKeyFromAvatar(hi.avatarId);
        const lv_image_dsc_t* iconDsc = nullptr;
        if (iconKey && iconLookup_) {
            iconDsc = iconLookup_(std::string(iconKey));
        }
        if (iconDsc) {
            auto* img = lv_image_create(disc);
            lv_image_set_src(img, iconDsc);
            lv_obj_set_style_image_recolor(img, Palette::ink(), 0);
            lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
            const int scale = (kDiscSize * 256) / 24;
            lv_image_set_scale(img, scale);
            lv_image_set_antialias(img, false);
            lv_obj_center(img);
        } else {
            // Two-letter fallback. Pull from the home name when
            // available; otherwise use "HM" (Howler home) as a
            // neutral placeholder so first-boot devices don't show
            // an empty disc.
            char fallback[3] = {0, 0, 0};
            if (iconKey) {
                const char* glyph = components::badgeTextForIcon(iconKey);
                snprintf(fallback, sizeof(fallback), "%.2s",
                         glyph ? glyph : "HM");
            } else if (!hi.displayName.empty()) {
                fallback[0] = static_cast<char>(hi.displayName[0]);
                if (hi.displayName.size() >= 2) {
                    fallback[1] = static_cast<char>(hi.displayName[1]);
                }
            } else {
                fallback[0] = 'H';
                fallback[1] = 'M';
            }
            auto* lbl = lv_label_create(disc);
            lv_label_set_text(lbl, fallback);
            lv_obj_set_style_text_color(lbl, Palette::ink(), 0);
            lv_obj_set_style_text_font(lbl, &lv_font_montserrat_10, 0);
            lv_obj_center(lbl);
        }

        // Home name — line 1, fw version line — line 2. The home
        // name is left-aligned next to the avatar; firmware version
        // sits below the name, right-aligned, smaller.
        const char* homeText = hi.displayName.empty()
            ? "Howler"
            : hi.displayName.c_str();
        auto* nameL = lv_label_create(card);
        lv_label_set_long_mode(nameL, LV_LABEL_LONG_DOT);
        lv_obj_set_width(nameL, 130);
        lv_label_set_text(nameL, homeText);
        lv_obj_set_style_text_color(nameL, Palette::ink(), 0);
        lv_obj_set_style_text_font(nameL, &lv_font_montserrat_12, 0);
        lv_obj_align(nameL, LV_ALIGN_TOP_LEFT, kDiscSize + 4, 0);

        char fwText[20];
        snprintf(fwText, sizeof(fwText), "fw %s",
                 application::kFirmwareVersion);
        auto* fwL = lv_label_create(card);
        lv_label_set_text(fwL, fwText);
        lv_obj_set_style_text_color(fwL, Palette::ink3(), 0);
        lv_obj_set_style_text_font(fwL, &lv_font_montserrat_10, 0);
        lv_obj_align(fwL, LV_ALIGN_TOP_LEFT, kDiscSize + 4, 12);
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

// Phase 6 OTA F4 — Settings → Updates. Surfaces the OtaService
// state machine. Single big label + action button; tap-to-advance
// drives the next legal transition (check → apply → finish). Knob
// click also activates the button so the encoder stays useful.
void ScreenManager::buildSettingsUpdates() {
    using application::OtaService;
    root_ = buildRoundBackground();

    {
        auto* h = lv_label_create(root_);
        lv_label_set_text(h, "Updates");
        lv_obj_set_style_text_color(h, Palette::ink2(), 0);
        lv_obj_set_style_text_font(h, &lv_font_montserrat_14, 0);
        lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 14);
    }

    auto& svc = app_.ota();
    const auto state = svc.state();

    // On first entry land in Idle — kick off a check immediately so
    // the user doesn't have to tap twice. The activate handler below
    // also runs requestCheck for re-checks from a finished state.
    if (state == OtaService::State::Idle) {
        svc.requestCheck();
    }

    // Status line — first line: top-level state. Second line:
    // version transition or error detail when relevant.
    char top[64];
    char sub[80];
    sub[0] = '\0';

    switch (state) {
        case OtaService::State::Idle:
            snprintf(top, sizeof(top), "Checking...");
            snprintf(sub, sizeof(sub), "now: %s",
                     application::kFirmwareVersion);
            break;
        case OtaService::State::Checking:
            snprintf(top, sizeof(top), "Checking...");
            snprintf(sub, sizeof(sub), "now: %s",
                     application::kFirmwareVersion);
            break;
        case OtaService::State::UpToDate:
            snprintf(top, sizeof(top), "Up to date");
            snprintf(sub, sizeof(sub), "%s",
                     application::kFirmwareVersion);
            break;
        case OtaService::State::UpdateAvailable:
            snprintf(top, sizeof(top), "Update available");
            snprintf(sub, sizeof(sub), "%s -> %s",
                     application::kFirmwareVersion,
                     svc.advisory().version.c_str());
            break;
        case OtaService::State::Downloading: {
            const int pct = svc.progressPercent();
            if (pct >= 0) {
                snprintf(top, sizeof(top), "Downloading %d%%", pct);
            } else {
                snprintf(top, sizeof(top), "Downloading...");
            }
            snprintf(sub, sizeof(sub), "%s",
                     svc.advisory().version.c_str());
            break;
        }
        case OtaService::State::Flashed:
            snprintf(top, sizeof(top), "Rebooting...");
            snprintf(sub, sizeof(sub), "do not power off");
            break;
        case OtaService::State::Failed:
            snprintf(top, sizeof(top), "Update failed");
            snprintf(sub, sizeof(sub), "%s",
                     svc.errorMessage().c_str());
            break;
    }

    {
        auto* l = lv_label_create(root_);
        lv_label_set_text(l, top);
        lv_obj_set_style_text_color(l, Palette::ink(), 0);
        lv_obj_set_style_text_font(l, &lv_font_montserrat_18, 0);
        lv_obj_align(l, LV_ALIGN_CENTER, 0, -16);
    }
    if (sub[0]) {
        auto* l = lv_label_create(root_);
        lv_label_set_text(l, sub);
        lv_obj_set_style_text_color(l, Palette::ink2(), 0);
        lv_obj_set_style_text_font(l, &lv_font_montserrat_12, 0);
        lv_obj_align(l, LV_ALIGN_CENTER, 0, 14);
    }

    // Action button — text mirrors the legal next transition. We
    // only render it for states that have a next action; the
    // download / flash / reboot states show the spinner-like top
    // label and explicitly DON'T show a button (the user can't
    // safely intervene mid-flash anyway). A long-press at root
    // pops back to Settings — same convention as Brightness.
    const char* btnText = nullptr;
    if (state == OtaService::State::UpdateAvailable) {
        btnText = "Update now";
    } else if (state == OtaService::State::UpToDate ||
               state == OtaService::State::Failed) {
        btnText = "Check again";
    }

    if (btnText) {
        auto* btn = lv_btn_create(root_);
        lv_obj_set_size(btn, 132, 36);
        lv_obj_align(btn, LV_ALIGN_BOTTOM_MID, 0, -34);
        lv_obj_set_style_radius(btn, 16, 0);
        lv_obj_set_style_shadow_width(btn, 0, 0);
        lv_obj_set_style_bg_color(btn, Palette::accent(), 0);
        auto* l = lv_label_create(btn);
        lv_label_set_text(l, btnText);
        lv_obj_set_style_text_color(l, Palette::paper(), 0);
        lv_obj_set_style_text_font(l, &lv_font_montserrat_14, 0);
        lv_obj_center(l);

        // Stash the current state on user_data so the handler picks
        // the right transition without re-reading via the manager.
        lv_obj_set_user_data(btn, (void*)(intptr_t)
            static_cast<uint8_t>(state));
        lv_obj_add_event_cb(btn, [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_CLICKED) return;
            auto* mgr = static_cast<ScreenManager*>(lv_event_get_user_data(e));
            auto* btn = lv_event_get_target_obj(e);
            const auto s = static_cast<OtaService::State>(
                (intptr_t)lv_obj_get_user_data(btn));
            auto& svc = mgr->app().ota();
            if (s == OtaService::State::UpdateAvailable) {
                svc.requestApply();
            } else {
                // UpToDate / Failed → re-run a check.
                svc.requestCheck();
            }
        }, LV_EVENT_CLICKED, this);

        if (group_) {
            lv_group_add_obj(group_, btn);
            lv_group_focus_obj(btn);
        }
    }

    auto* hint = lv_label_create(root_);
    lv_label_set_text(hint, "2x back");
    lv_obj_set_style_text_color(hint, Palette::ink3(), 0);
    lv_obj_set_style_text_font(hint, &lv_font_montserrat_10, 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -8);
}

}  // namespace howler::screens
