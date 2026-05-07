// LVGL bring-up + frame loop + per-screen builders. Per-screen
// builders live in screen_*.cpp so this file stays focused on the
// framework concerns. LVGL 9 API.

#include "ScreenManager.h"

namespace howler::screens {

namespace {

TFT_eSPI* g_tft = nullptr;

constexpr int kScreenW = 240;
constexpr int kScreenH = 240;
constexpr size_t kBufLines = 40;

// Static draw buffer for partial-mode rendering.
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

// Encoder state pumped by the manager's pollAndDispatch.
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

void ScreenManager::tick(uint32_t /*millisNow*/) {
    pollAndDispatch();
    if (app_.router().current() != rendered_) {
        rebuildScreen();
    }
    lv_timer_handler();
}

void ScreenManager::pollAndDispatch() {
    int delta = 0;
    bool press = false;
    bool longPress = false;
    using application::IInputDevice;
    while (true) {
        const auto e = input_.poll();
        if (e == IInputDevice::Event::None) break;
        if (e == IInputDevice::Event::RotateCW)  ++delta;
        else if (e == IInputDevice::Event::RotateCCW) --delta;
        else if (e == IInputDevice::Event::Press) press = true;
        else if (e == IInputDevice::Event::LongPress) longPress = true;
    }
    if (delta == 0 && !press && !longPress) return;
    // Forward to LVGL focus engine for ChangeFocus/ClickButton — only
    // when a screen registers focusable widgets does this matter; for
    // pure-drawing screens (Pair, Boot) the manager routes events
    // itself via onEvent.
    g_enc.pendingDelta += delta;
    if (press || longPress) g_enc.pendingPress = true;
    onEvent(delta, press, longPress);
    if (press || longPress) {
        g_enc.pendingPress = false;
    }
}

void ScreenManager::teardownScreen() {
    if (group_) lv_group_remove_all_objs(group_);
    if (root_) {
        lv_obj_del(root_);
        root_ = nullptr;
    }
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

void ScreenManager::onEvent(int rotateDelta, bool press, bool longPress) {
    using domain::ScreenId;
    auto& app = app_;
    auto& router = app.router();

    // Universal: long-press at non-root pops; at dashboard root opens
    // settings. Pair root long-press cancels the current pair attempt.
    if (longPress) {
        if (rendered_ == ScreenId::Dashboard) {
            router.push(ScreenId::Settings);
            return;
        }
        if (router.pop()) return;
    }

    switch (rendered_) {
        case ScreenId::Dashboard: {
            if (rotateDelta != 0) app.dashboard().moveCursor(rotateDelta);
            if (press) {
                const auto* sel = app.dashboard().selected();
                if (sel) {
                    app.pendingDone() = {};
                    app.pendingDone().taskId = sel->taskId;
                    app.pendingDone().occurrenceId = sel->occurrenceId;
                    app.pendingDone().resultTypeId = sel->resultTypeId;
                    router.push(sel->resultTypeId.empty() ? ScreenId::UserPicker
                                                          : ScreenId::ResultPicker);
                }
            }
            break;
        }
        case ScreenId::ResultPicker: {
            if (press) router.push(ScreenId::UserPicker);
            break;
        }
        case ScreenId::UserPicker: {
            if (press) {
                app.commitPendingDone();
                router.replaceRoot(ScreenId::Dashboard);
            }
            break;
        }
        default:
            // Per-screen LVGL event callbacks set up in build* methods
            // handle the rest.
            break;
    }
}

}  // namespace howler::screens
