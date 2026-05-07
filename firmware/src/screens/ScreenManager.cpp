// LVGL bring-up + frame loop + per-screen builders. Per-screen
// builders live in screen_*.cpp so this file stays focused on the
// framework concerns. LVGL 9 API.

#include "ScreenManager.h"
#include "../application/PairCoordinator.h"

namespace howler::screens {

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
    data->state = g_enc.pendingPress ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

}  // namespace

ScreenManager::ScreenManager(application::App& app, application::IInputDevice& input)
    : app_(app), input_(input) {}

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

    if (app_.router().current() != rendered_) {
        rebuildScreen();
    }
    lv_timer_handler();
}

void ScreenManager::pollAndDispatch(uint32_t /*millisNow*/) {
    int delta = 0;
    bool tap = false;
    bool doubleTap = false;
    bool longPress = false;
    using application::IInputDevice;
    while (true) {
        const auto e = input_.poll();
        if (e == IInputDevice::Event::None) break;
        if      (e == IInputDevice::Event::RotateCW)  ++delta;
        else if (e == IInputDevice::Event::RotateCCW) --delta;
        else if (e == IInputDevice::Event::Press)     tap = true;
        else if (e == IInputDevice::Event::DoubleTap) doubleTap = true;
        else if (e == IInputDevice::Event::LongPress) longPress = true;
    }
    if (delta == 0 && !tap && !doubleTap && !longPress) return;
    g_enc.pendingDelta += delta;
    if (tap || longPress) g_enc.pendingPress = true;
    onEvent(delta, tap, doubleTap, longPress);
    if (tap || longPress) g_enc.pendingPress = false;
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
    menuActive_ = false;
}

void ScreenManager::rebuildScreen() {
    teardownScreen();
    rendered_ = app_.router().current();
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
        case ScreenId::Wifi:               buildWifi();              break;
        case ScreenId::WifiConnect:        buildWifiConnect();       break;
        case ScreenId::LoginQr:            buildLoginQr();           break;
        case ScreenId::OfflineNotice:      buildOfflineNotice();     break;
    }
}

void ScreenManager::onEvent(int rotateDelta, bool tap, bool doubleTap, bool longPress) {
    using domain::ScreenId;
    auto& app = app_;
    auto& router = app.router();

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

    // ── RoundMenu screens (Settings, UserPicker, Wi-Fi list) ────
    // Forward the rotary delta and tap to the menu component;
    // long-press is handled per-screen below for any destructive
    // confirm. Build* sets menuActive_ when this routing should
    // engage.
    if (menuActive_) {
        if (rotateDelta != 0) menu_.onRotate(rotateDelta);
        if (tap) menu_.fireActivate();
    }

    switch (rendered_) {
        case ScreenId::Dashboard: {
            if (rotateDelta != 0) app.dashboard().moveCursor(rotateDelta);
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
            }
            break;
        }
        case ScreenId::ResultPicker: {
            if (rotateDelta != 0) {
                app.resultEdit().nudge(rotateDelta);
                if (resultValueLabel_) {
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
        default:
            // Per-screen LVGL event callbacks set up in build*
            // methods handle the rest.
            break;
    }
}

}  // namespace howler::screens
