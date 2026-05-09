// LVGL bring-up + frame loop + per-screen builders. Per-screen
// builders live in screen_*.cpp so this file stays focused on the
// framework concerns. LVGL 9 API.

#include "ScreenManager.h"
#include "components/DrumScroller.h"
#include "components/RoundCard.h"
#include "../application/PairCoordinator.h"

namespace howler::screens {

using components::updateDrumRimIndicator;

namespace {

TFT_eSPI* g_tft = nullptr;

constexpr int kScreenW = 240;
constexpr int kScreenH = 240;
constexpr size_t kBufLines = 40;

lv_color_t g_drawBuf[kScreenW * kBufLines];

void flush_cb(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map) {
    if (!g_tft) { lv_display_flush_ready(disp); return; }
    const uint16_t w = (area->x2 - area->x1 + 1);
    const uint16_t h = (area->y2 - area->y1 + 1);
    g_tft->startWrite();
    g_tft->setAddrWindow(area->x1, area->y1, w, h);
    g_tft->pushColors(reinterpret_cast<uint16_t*>(px_map), w * h, true);
    g_tft->endWrite();
    lv_display_flush_ready(disp);
}

// Encoder driver state — pumped by pollAndDispatch.
struct EncoderState {
    int  pendingDelta = 0;
    bool pendingPress = false;
};
EncoderState g_enc;

void encoder_read_cb(lv_indev_t*, lv_indev_data_t* data) {
    data->enc_diff = static_cast<int16_t>(g_enc.pendingDelta);
    g_enc.pendingDelta = 0;
    // Consume-on-read so LVGL sees a PRESSED edge followed by a
    // RELEASED on the next read — the press-release sequence is
    // what triggers `LV_EVENT_CLICKED` on the focused widget. The
    // previous "set true / synchronously set false in
    // pollAndDispatch" pattern raced lv_timer_handler: by the time
    // LVGL polled the indev the flag was already false, so no
    // press edge ever appeared and screens that relied on LVGL's
    // standard encoder click (e.g. SettingsTheme's two pills)
    // never saw their tap.
    if (g_enc.pendingPress) {
        data->state = LV_INDEV_STATE_PRESSED;
        g_enc.pendingPress = false;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

}  // namespace

ScreenManager::ScreenManager(application::App& app, application::IInputDevice& input)
    : app_(app), input_(input),
      iconCache_(app.network(), app.clock()),
      iconLookup_([this](const std::string& name) {
          return iconCache_.get(name);
      }) {}

void ScreenManager::begin(TFT_eSPI& tft) {
    g_tft = &tft;
    lv_init();

    // LVGL 9 dropped the LV_TICK_CUSTOM compile-time macro from
    // lv_conf — set the tick getter explicitly so lv_timer_handler
    // sees real wall-clock progress and processes input events.
    lv_tick_set_cb([]() -> uint32_t { return millis(); });

    auto* disp = lv_display_create(kScreenW, kScreenH);
    lv_display_set_flush_cb(disp, flush_cb);
    lv_display_set_buffers(disp, g_drawBuf, nullptr,
                           sizeof(g_drawBuf),
                           LV_DISPLAY_RENDER_MODE_PARTIAL);

    auto* indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_ENCODER);
    lv_indev_set_read_cb(indev, encoder_read_cb);
    group_ = lv_group_create();
    lv_indev_set_group(indev, group_);

    // dev-27: lv_scr_act() defaults to white in the LVGL theme. Our
    // disc bg is rounded to a circle; the corners of the 240×240
    // screen object that fall outside the circle expose the
    // underlying screen bg. On dark theme that white-corner ring
    // showed as a faint light edge around the disc. Force the
    // screen bg to pure black so any AA / corner pixels transition
    // into the unlit bezel area cleanly regardless of theme.
    lv_obj_set_style_bg_color(lv_scr_act(), lv_color_black(), 0);
    lv_obj_set_style_bg_opa(lv_scr_act(), LV_OPA_COVER, 0);

    rebuildScreen();
}

void ScreenManager::tick(uint32_t millisNow) {
    pollAndDispatch(millisNow);

    // Update the long-press arc once per frame from the current
    // hold state. Independent of screen rebuilds — even if the user
    // starts holding mid-rebuild the arc model carries the start
    // time forward across the brief frame the new screen takes to
    // re-create the widget.
    longPressArc_.update(millisNow, input_.isHeld());
    longPressArcWidget_.update(longPressArc_);

    // Pick up the server-side "now" so dashboard date math is
    // immune to dial-clock drift before SNTP completes.
    lastServerNowSec_ = app_.serverNowSec();

    // Auto-fade the toast overlay once its window expires.
    if (toastLabel_ && toastUntilMs_ != 0 && millisNow >= toastUntilMs_) {
        lv_obj_del(toastLabel_);
        toastLabel_ = nullptr;
        toastUntilMs_ = 0;
    }

    // Same lifecycle for the done-animation overlay.
    if (doneOverlay_ && doneUntilMs_ != 0 && millisNow >= doneUntilMs_) {
        lv_obj_del(doneOverlay_);
        doneOverlay_ = nullptr;
        doneUntilMs_ = 0;
    }

    // Sync-aware refresh: when the dashboard / all-tasks model
    // generation advances (i.e. a sync round replaced items, or a
    // mark-done removed one), rebuild the matching screen so the
    // user sees the new state without having to scroll first. Only
    // triggers when we're CURRENTLY on the affected screen — other
    // navigations refresh naturally on their next entry.
    if (rendered_ == domain::ScreenId::Dashboard &&
        app_.dashboard().generation() != lastDashboardGen_) {
        rebuildPending_ = true;
    }
    if (rendered_ == domain::ScreenId::TaskList &&
        app_.allTasks().generation() != lastAllTasksGen_) {
        rebuildPending_ = true;
    }

    // Drain at most one pending icon fetch per tick so the network
    // round-trip never lands on the render path (a synchronous
    // fetch from inside a draw callback can block LVGL for 100s of
    // ms — visible as a stutter when the dashboard first paints).
    // If a fetch lands, the cache's generation bumps; the rebuild
    // path below picks that up to repaint the avatars whose
    // fallback glyph is now backed by a real bitmap.
    //
    // First time we have a usable network, prewarm the cache with
    // every icon name the backend has seeded. We ask for the manifest
    // (`GET /api/icons`) so the device doesn't need its own copy of
    // LABEL_ICON_CHOICES — adding a new icon to the seed migration
    // automatically reaches the device on next boot. The hardcoded
    // fallback below covers the (rare) case where the manifest call
    // fails on the first online tick; lazy fetches still work on
    // demand even if neither path populates the cache.
    if (!iconCachePrewarmed_ && app_.network().isOnline()) {
        std::vector<std::string> names;
        const auto r = app_.network().fetchIconManifest(names);
        if (r.isOk() && !names.empty()) {
            iconCache_.prewarm(names);
        } else {
            // Fallback: the LABEL_ICON_CHOICES set as of dev-22, last
            // verified against home2 production on 2026-05-08. Stays
            // sufficient if the manifest endpoint goes down — the
            // device just won't pick up newly-added icons until the
            // manifest is reachable again.
            const std::vector<std::string> kFallback = {
                "paw", "dog", "cat", "broom", "home", "bowl",
                "heart", "sparkle", "star", "plant", "flame", "bell",
                "briefcase", "book", "run", "pill", "tooth", "clock",
                "calendar", "check",
            };
            iconCache_.prewarm(kFallback);
        }
        iconCachePrewarmed_ = true;
    }
    iconCache_.tickPrefetch(/*maxPerTick=*/1);
    if ((rendered_ == domain::ScreenId::Dashboard ||
         rendered_ == domain::ScreenId::TaskList) &&
        iconCache_.generation() != lastIconCacheGen_) {
        rebuildPending_ = true;
    }

    // Live About refresh — repaint the diagnostic body once a second
    // while SettingsAbout is rendered so sync age / uptime / ram /
    // queue depth tick forward without a full screen rebuild. The
    // label pointer is set by `buildSettingsAbout` and cleared in
    // `teardownScreen`, so the guard covers screen transitions.
    if (rendered_ == domain::ScreenId::SettingsAbout &&
        aboutBodyLabel_ && millisNow >= aboutNextRefreshMs_) {
        refreshSettingsAbout();
        aboutNextRefreshMs_ = millisNow + 1000;
    }

    // User-initiated Sync-now follow-through. Either the watermark
    // advanced (success) or the deadline elapsed (failure /
    // offline). The result toast replaces the in-flight
    // "syncing..." via showToast's delete-and-recreate path.
    if (userSyncRequestActive_) {
        if (app_.lastFullSyncSec() > userSyncBaselineSec_) {
            showToast("synced", 1200);
            userSyncRequestActive_ = false;
        } else if (millisNow >= userSyncDeadlineMs_) {
            // Distinguish "we tried and failed" from "we never
            // tried because no network" — the user wants to know
            // which side the problem is on.
            const bool online = app_.network().isOnline();
            showToast(online ? "sync failed" : "sync offline",
                      online ? 1500u        : 1200u);
            userSyncRequestActive_ = false;
        }
    }

    if (app_.router().current() != rendered_ || rebuildPending_) {
        rebuildPending_ = false;
        rebuildScreen();
    }
    lv_timer_handler();
}

bool ScreenManager::isOnTaskListRoot() const {
    return rendered_ == domain::ScreenId::TaskList;
}

size_t ScreenManager::mainScreenIndex() const {
    constexpr auto N = sizeof(kMainScreens) / sizeof(kMainScreens[0]);
    for (size_t i = 0; i < N; ++i) if (kMainScreens[i] == rendered_) return i;
    return N;
}

void ScreenManager::playDoneAnimation(uint32_t durationMs) {
    // Replace any in-flight overlay so back-to-back commits don't
    // queue a stack of identical checks.
    if (doneOverlay_) {
        lv_obj_del(doneOverlay_);
        doneOverlay_ = nullptr;
    }

    // The overlay is a circular green badge with the LV_SYMBOL_OK
    // glyph in the centre. Built on lv_layer_top so it floats above
    // every screen tree and is unaffected by rebuilds.
    auto* circle = lv_obj_create(lv_layer_top());
    lv_obj_set_size(circle, 120, 120);
    lv_obj_center(circle);
    lv_obj_clear_flag(circle, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(circle, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(circle, components::Palette::success(), 0);
    lv_obj_set_style_bg_opa(circle, LV_OPA_90, 0);
    lv_obj_set_style_border_width(circle, 0, 0);
    lv_obj_set_style_pad_all(circle, 0, 0);

    auto* check = lv_label_create(circle);
    lv_label_set_text(check, LV_SYMBOL_OK);
    lv_obj_set_style_text_color(check, components::Palette::paper(), 0);
    lv_obj_set_style_text_font(check, &lv_font_montserrat_22, 0);
    lv_obj_center(check);

    // Scale + fade animation. The badge grows from ~70 % to 100 %
    // over the first ~250 ms (a "stamp" feel), holds, then fades
    // out at the end of the window.
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, circle);
    lv_anim_set_values(&a, 70, 100);
    lv_anim_set_time(&a, 220);
    lv_anim_set_path_cb(&a, lv_anim_path_overshoot);
    lv_anim_set_exec_cb(&a, [](void* var, int32_t v) {
        const int side = (120 * v) / 100;
        lv_obj_set_size(static_cast<lv_obj_t*>(var), side, side);
        lv_obj_center(static_cast<lv_obj_t*>(var));
    });
    lv_anim_start(&a);

    // Fade-out at the tail end so the screen comes back to the
    // detailed task view without a hard cut.
    lv_anim_t fade;
    lv_anim_init(&fade);
    lv_anim_set_var(&fade, circle);
    lv_anim_set_values(&fade, LV_OPA_90, LV_OPA_TRANSP);
    lv_anim_set_time(&fade, 250);
    lv_anim_set_delay(&fade, durationMs > 300 ? durationMs - 300 : 0);
    lv_anim_set_exec_cb(&fade, [](void* var, int32_t v) {
        lv_obj_set_style_bg_opa(static_cast<lv_obj_t*>(var),
                                static_cast<lv_opa_t>(v), 0);
    });
    lv_anim_start(&fade);

    doneOverlay_ = circle;
    doneUntilMs_ = millis() + durationMs;

    // When we're offline the green check is technically misleading
    // — the mark-done is queued locally but hasn't reached the
    // server. Surface that with a low-key toast next to the overlay
    // so the user knows the action will sync on the next round.
    // Showing it after the overlay is built means it lands on top
    // (lv_layer_top renders in insertion order, last-on-top).
    if (app_.networkHealth() ==
        application::App::NetworkHealth::Offline) {
        showToast("queued offline", durationMs > 200
                                   ? durationMs - 200 : 800);
    }
}

void ScreenManager::showToast(const char* text, uint32_t durationMs) {
    // Re-create even if a previous toast is still up so the new
    // message isn't queued. Parent = top layer so the toast sits
    // above whatever screen LVGL is currently rendering.
    if (toastLabel_) {
        lv_obj_del(toastLabel_);
        toastLabel_ = nullptr;
    }
    auto* l = lv_label_create(lv_layer_top());
    lv_label_set_text(l, text);
    lv_obj_set_style_text_color(l, components::Palette::paper(), 0);
    lv_obj_set_style_bg_color(l, components::Palette::ink(), 0);
    lv_obj_set_style_bg_opa(l, LV_OPA_80, 0);
    lv_obj_set_style_pad_all(l, 8, 0);
    lv_obj_set_style_radius(l, 14, 0);
    lv_obj_align(l, LV_ALIGN_BOTTOM_MID, 0, -36);
    toastLabel_   = l;
    toastUntilMs_ = millis() + durationMs;
}

void ScreenManager::pollAndDispatch(uint32_t /*millisNow*/) {
    int delta = 0;
    int vert = 0;
    int horz = 0;
    bool tap = false;
    bool doubleTap = false;
    bool longPress = false;
    using application::IInputDevice;
    while (true) {
        const auto e = input_.poll();
        if (e == IInputDevice::Event::None) break;
        // Inertial-swipe magnitude: a fast flick reads as N>1 here so
        // downstream handlers can move their cursor by N items in one
        // gesture (iPhone-list-flick feel). Encoder events always
        // contribute ±1; only Swipe* carries velocity.
        if      (e == IInputDevice::Event::RotateCW)   ++delta;
        else if (e == IInputDevice::Event::RotateCCW)  --delta;
        else if (e == IInputDevice::Event::Press)      tap = true;
        else if (e == IInputDevice::Event::DoubleTap)  doubleTap = true;
        else if (e == IInputDevice::Event::LongPress)  longPress = true;
        else if (e == IInputDevice::Event::SwipeUp)    vert += input_.lastSwipeMagnitude();
        else if (e == IInputDevice::Event::SwipeDown)  vert -= input_.lastSwipeMagnitude();
        else if (e == IInputDevice::Event::SwipeLeft)  horz += input_.lastSwipeMagnitude();
        else if (e == IInputDevice::Event::SwipeRight) horz -= input_.lastSwipeMagnitude();
    }
    if (delta == 0 && vert == 0 && horz == 0 &&
        !tap && !doubleTap && !longPress) return;
    g_enc.pendingDelta += delta;
    // Set the press latch and let `encoder_read_cb` consume it on
    // the next LVGL read — that produces the PRESSED → RELEASED
    // edge LVGL needs for CLICKED. Clearing here would race
    // lv_timer_handler and swallow the press silently.
    if (tap || longPress) g_enc.pendingPress = true;
    onEvent(delta, tap, doubleTap, longPress, vert, horz);
}

void ScreenManager::requestUserSync() {
    // Capture the watermark BEFORE asking SyncService to run a
    // round so we can detect advancement against this exact value.
    // Setting requestSync() before reading the watermark would race
    // an in-flight tick that's already running a round — we'd see
    // the new value and report success without the user-initiated
    // round having actually executed.
    userSyncBaselineSec_   = app_.lastFullSyncSec();
    // 6 s budget — typical successful round is 0.5–2 s; the long
    // tail (DNS reset, slow Wi-Fi reassociation) is rare enough
    // that timing out and showing "sync failed" is the right
    // user-visible signal even when a stuck round eventually
    // succeeds. The next 30 s tick will then update the badge if
    // it lands later.
    userSyncDeadlineMs_    = millis() + 6000;
    userSyncRequestActive_ = true;
    app_.sync().requestSync();
    showToast("syncing...", 1500);
}

void ScreenManager::paintNetworkBadge() {
    if (!root_) return;
    using components::buildNetworkBadge;
    using components::Palette;
    switch (app_.networkHealth()) {
        case application::App::NetworkHealth::Offline:
            buildNetworkBadge(root_, "OFFLINE", Palette::accent());
            break;
        case application::App::NetworkHealth::Stale:
            buildNetworkBadge(root_, "STALE",   Palette::warn());
            break;
        case application::App::NetworkHealth::Fresh:
            // No badge — Fresh is the silent default.
            break;
    }
}

void ScreenManager::teardownScreen() {
    if (group_) lv_group_remove_all_objs(group_);
    if (root_) {
        lv_obj_del(root_);
        root_ = nullptr;
    }
    // Cached pointers into root_'s subtree are now dangling. Clear
    // them before any next frame can read them.
    longPressArcWidget_.reset();
    resultValueLabel_ = nullptr;
    valueWidget_.reset();  // ResultPicker's specialised value visual
    menuActive_ = false;
    // taskDrum_'s LVGL pointers are about to be deleted with root_;
    // clear the active flag so onEvent doesn't try to scroll a drum
    // whose container_ is dangling. The drum's value-typed slots
    // get overwritten on the next build() so nothing leaks.
    taskDrumActive_ = false;
    taskCursorDots_ = nullptr;
    taskIndexLabel_ = nullptr;
    // About-screen live-refresh state — the label is a child of
    // root_ which we just deleted; clear the pointer so the next
    // tick() doesn't try to set_text on a stale lv_obj.
    aboutBodyLabel_     = nullptr;
    aboutNextRefreshMs_ = 0;
}

void ScreenManager::rebuildScreen() {
    teardownScreen();
    // Sync the static palette flag to the active theme before any
    // screen builder pulls colors. The builders call Palette::* per
    // widget; once cached on a child object the colour sticks until
    // the next rebuild, which is exactly what we want — toggling
    // theme triggers a rebuild via the same path.
    components::Palette::setDark(
        app_.settings().theme == domain::Theme::Dark);
    rendered_ = app_.router().current();
    // Snapshot the model generations so the sync-aware refresh in
    // tick() can detect future data updates relative to "what we
    // last rendered with". Doing this here (after teardown, before
    // build) guarantees we never see a generation bump from an
    // update that happened during the rebuild itself.
    lastDashboardGen_ = app_.dashboard().generation();
    lastAllTasksGen_  = app_.allTasks().generation();
    lastIconCacheGen_ = iconCache_.generation();
    using domain::ScreenId;
    switch (rendered_) {
        case ScreenId::Boot:               buildBoot();              break;
        case ScreenId::Pair:               buildPair();              break;
        case ScreenId::Dashboard:          buildDashboard();         break;
        case ScreenId::TaskList:           buildTaskList();          break;
        case ScreenId::TaskDetail:         buildTaskDetail();        break;
        case ScreenId::ResultPicker:       buildResultPicker();      break;
        case ScreenId::UserPicker:         buildUserPicker();        break;
        case ScreenId::Settings:           buildSettings();          break;
        case ScreenId::SettingsBrightness: buildSettingsBrightness(); break;
        case ScreenId::SettingsAbout:      buildSettingsAbout();     break;
        case ScreenId::SettingsTheme:      buildSettingsTheme();     break;
        case ScreenId::Wifi:               buildWifi();              break;
        case ScreenId::WifiConnect:        buildWifiConnect();       break;
        case ScreenId::LoginQr:            buildLoginQr();           break;
        case ScreenId::OfflineNotice:      buildOfflineNotice();     break;
    }
}

void ScreenManager::onEvent(int rotateDelta, bool tap, bool doubleTap,
                            bool longPress, int vertSwipe, int horzSwipe) {
    using domain::ScreenId;
    auto& app = app_;
    auto& router = app.router();

    // ── Pill switching: horizontal swipe ONLY ──────────────────
    // The rotary stays focused on the active screen's content (knob
    // == cursor / value editor / menu cursor depending on screen).
    // Pills are not in the rotary's lane; they're touch-only via
    // a deliberate horizontal flick. SwipeLeft = next pill (mobile
    // carousel convention: finger sweeps the new screen in from
    // the right edge), SwipeRight = previous.
    if (horzSwipe != 0 && router.atRoot()) {
        constexpr auto N = sizeof(kMainScreens) / sizeof(kMainScreens[0]);
        size_t idx = N;
        for (size_t i = 0; i < N; ++i) if (kMainScreens[i] == rendered_) idx = i;
        if (idx < N) {
            const long s = (horzSwipe > 0) ? 1 : -1;
            const long next = ((static_cast<long>(idx) + s)
                              % static_cast<long>(N)
                              + static_cast<long>(N)) % static_cast<long>(N);
            router.replaceRoot(kMainScreens[next]);
            return;
        }
    }

    // ── Round-menu screens: rotation + vertical swipe nudge cursor;
    //    tap fires the activate callback. Works at both root
    //    (Settings) and non-root (Wi-Fi, UserPicker, etc.) — knob
    //    always drives the on-screen content. The tap dispatch
    //    here replaces the LVGL-focus-group path the lv_list
    //    versions of these screens used to ride; the RoundMenu
    //    centre container isn't in the encoder group, so we
    //    forward the press event explicitly.
    //
    // Inertial-swipe path: vertSwipe already absorbed each Swipe
    // event's per-event magnitude (see pollAndDispatch), so a fast
    // flick lands in `vertSwipe` as e.g. ±3. The menu's onScroll
    // takes (direction, magnitude) and plays one ease-out animation
    // covering the multi-item jump.
    if (menuActive_) {
        if (rotateDelta != 0) menu_.onRotate(rotateDelta);
        if (vertSwipe   != 0) {
            const int dir = vertSwipe > 0 ? 1 : -1;
            const int mag = vertSwipe > 0 ? vertSwipe : -vertSwipe;
            menu_.onScroll(dir, mag);
        }
        if (tap)              menu_.fireActivate();
    }

    // ── Universal: DoubleTap = back / cancel ────────────────────
    // At root, "back" is undefined, so we shortcut to Settings —
    // the user always has a path off any root screen without arming
    // a hidden gesture. Inside a flow, pop one level.
    if (doubleTap) {
        if (router.atRoot()) {
            router.push(ScreenId::Settings);
            return;
        }
        if (router.pop()) return;
    }

    // ── Pair-screen escape hatch ────────────────────────────────
    // No other meaningful actions on the pair screen; any input
    // jumps to Settings so a Wi-Fi-less device stays recoverable.
    if (rendered_ == ScreenId::Pair && (tap || longPress || rotateDelta != 0)) {
        router.push(ScreenId::Settings);
        return;
    }

    // (Earlier block already forwarded rotation + scroll + tap to
    //  the menu when active — no second forwarder here, that used to
    //  duplicate-fire taps and double-step the cursor on rotation.)

    switch (rendered_) {
        case ScreenId::Dashboard: {
            // Knob rotation AND vertical swipe both move the dashboard
            // cursor — knob is the primary, swipe is touch parity.
            // Pills switch only via horizontal swipe (above).
            //
            // Drum scroll path: the DrumScroller renders the centre
            // detailed card + neighbour minis with a slide animation
            // on each cursor change. We feed (direction, magnitude)
            // into scrollBy so a fast flick lands multiple items
            // away with a single ease-out animation, then mirror the
            // drum's resulting cursor back into the model so the
            // mark-done dispatch below picks the right task. NO
            // requestRebuild — the drum animates in place; the
            // surrounding chrome (tab strip, tier counts, footer
            // hint) doesn't depend on the cursor and stays put.
            auto applyScroll = [this](int direction, int magnitude) {
                if (!taskDrumActive_) return;
                taskDrum_.scrollBy(direction, magnitude);
                app_.dashboard().setCursor(taskDrum_.cursor());
                updateDrumRimIndicator(taskCursorDots_,
                                      app_.dashboard().size(),
                                      app_.dashboard().cursor());
            };
            if (rotateDelta != 0) {
                applyScroll(rotateDelta > 0 ? 1 : -1,
                            rotateDelta > 0 ? rotateDelta : -rotateDelta);
            }
            if (vertSwipe != 0) {
                applyScroll(vertSwipe > 0 ? 1 : -1,
                            vertSwipe > 0 ? vertSwipe : -vertSwipe);
            }
            const auto* sel = app.dashboard().selected();
            if (!sel) break;
            if (tap) {
                // Tap = enter the result/user mark-done flow.
                app.pendingDone() = {};
                app.pendingDone().taskId = sel->taskId;
                app.pendingDone().occurrenceId = sel->occurrenceId;
                app.pendingDone().resultTypeId = sel->resultTypeId;
                router.push(sel->resultTypeId.empty()
                            ? ScreenId::UserPicker
                            : ScreenId::ResultPicker);
            } else if (longPress) {
                // Long-press = quick mark-done (no result, no user).
                // The arc gave the user 600 ms of "are you sure"
                // feedback; releasing before fill produces nothing.
                app.pendingDone() = {};
                app.pendingDone().taskId = sel->taskId;
                app.pendingDone().occurrenceId = sel->occurrenceId;
                app.pendingDone().resultTypeId = "";
                app.pendingDone().userId = "";
                app.pendingDone().hasResultValue = false;
                app.commitPendingDone();
                playDoneAnimation();
                // The dashboard model just shed the acknowledged item.
                // Force a rebuild so the drum reconstructs against the
                // new item list — without it we'd render the still-live
                // drum with a stale items reference behind the green
                // check overlay.
                requestRebuild();
            }
            break;
        }
        case ScreenId::ResultPicker: {
            // Rotation + horizontal swipe both nudge the active
            // value editor; `vertSwipe` is reserved for the bowl
            // (Grams) widget so it's also routed in. The widget's
            // `update()` repaints the visual in place — no rebuild.
            const int delta = rotateDelta + horzSwipe + vertSwipe;
            if (delta != 0) {
                app.resultEdit().nudge(delta);
                const auto* rt = app.findResultType(
                    app.pendingDone().resultTypeId);
                if (valueWidget_ && rt) {
                    valueWidget_->update(app.resultEdit().value(), *rt);
                } else if (resultValueLabel_) {
                    lv_label_set_text(resultValueLabel_,
                                      app.resultEdit().formatValue().c_str());
                }
            } else if (tap) {
                // Tap = accept current value, advance to user picker.
                app.pendingDone().hasResultValue = true;
                app.pendingDone().resultValue = app.resultEdit().value();
                router.push(ScreenId::UserPicker);
            } else if (longPress) {
                // Long-press = skip the result entirely (no value
                // recorded), advance to user picker.
                app.pendingDone().hasResultValue = false;
                router.push(ScreenId::UserPicker);
            }
            break;
        }
        case ScreenId::UserPicker: {
            // Tap activation handled by the round menu activate
            // callback (forwarded earlier in this function via
            // menuActive_). LongPress = quick "skip user, commit".
            if (longPress) {
                app.pendingDone().userId = "";
                app.commitPendingDone();
                playDoneAnimation();
                router.replaceRoot(ScreenId::Dashboard);
            }
            break;
        }
        case ScreenId::Settings: {
            // Long-press on the Unpair item performs the destructive
            // action. Round menu shows the accent border on items
            // marked destructive so users can tell.
            if (longPress) {
                const auto* sel = menuModel_.selected();
                if (sel && sel->id == "unpair") {
                    application::PairCoordinator::clearToken(app.storage());
                    router.replaceRoot(ScreenId::Pair);
                    app.pair().start(app.deviceId());
                }
            }
            break;
        }
        case ScreenId::TaskList: {
            // Same UX as Dashboard, just driven by `allTasks()` so
            // every active task is reachable (not just the urgency
            // tier the home screen surfaces). Knob + vertical swipe
            // spin the drum; tap enters the standard mark-done flow;
            // long-press is the quick-done shortcut.
            auto applyScroll = [this](int direction, int magnitude) {
                if (!taskDrumActive_) return;
                taskDrum_.scrollBy(direction, magnitude);
                app_.allTasks().setCursor(taskDrum_.cursor());
                updateDrumRimIndicator(taskCursorDots_,
                                      app_.allTasks().size(),
                                      app_.allTasks().cursor());
                // dev-27: keep the bottom "X / N" index in lockstep
                // with the drum's animated cursor. lv_label_set_text
                // is cheap; LVGL only repaints the dirty rectangle.
                if (taskIndexLabel_) {
                    char buf[16];
                    snprintf(buf, sizeof(buf), "%u / %u",
                        static_cast<unsigned>(app_.allTasks().cursor() + 1),
                        static_cast<unsigned>(app_.allTasks().size()));
                    lv_label_set_text(taskIndexLabel_, buf);
                }
            };
            if (rotateDelta != 0) {
                applyScroll(rotateDelta > 0 ? 1 : -1,
                            rotateDelta > 0 ? rotateDelta : -rotateDelta);
            }
            if (vertSwipe != 0) {
                applyScroll(vertSwipe > 0 ? 1 : -1,
                            vertSwipe > 0 ? vertSwipe : -vertSwipe);
            }
            const auto* sel = app.allTasks().selected();
            if (!sel) break;
            if (tap) {
                app.pendingDone() = {};
                app.pendingDone().taskId = sel->taskId;
                app.pendingDone().occurrenceId = sel->occurrenceId;
                app.pendingDone().resultTypeId = sel->resultTypeId;
                router.push(sel->resultTypeId.empty()
                            ? ScreenId::UserPicker
                            : ScreenId::ResultPicker);
            } else if (longPress) {
                app.pendingDone() = {};
                app.pendingDone().taskId = sel->taskId;
                app.pendingDone().occurrenceId = sel->occurrenceId;
                app.pendingDone().resultTypeId = "";
                app.pendingDone().userId = "";
                app.pendingDone().hasResultValue = false;
                app.commitPendingDone();
                playDoneAnimation();
                // Same rebuild reason as the Dashboard branch — the
                // drum still references the pre-commit items vector;
                // letting it stay would render the just-dropped task
                // until the next navigation event.
                requestRebuild();
            }
            break;
        }
        default:
            // Per-screen LVGL event callbacks set up in build*
            // methods handle the rest.
            break;
    }
}

}  // namespace howler::screens
