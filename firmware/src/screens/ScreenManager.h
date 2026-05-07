#pragma once

#include "../application/App.h"
#include "../application/Ports.h"
#include "../domain/Router.h"

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <lvgl.h>

namespace howler::screens {

/// Owns the LVGL display + input drivers and routes between screens
/// based on `App::router().current()`. The App is the single source
/// of truth for navigation; screens never push other screens directly
/// — they call `app.router().push(…)` and let the manager rebuild on
/// the next frame.
///
/// LVGL's encoder group ties tab order into rotary movement. Each
/// screen registers its focusable widgets into `group_` on entry and
/// clears it on exit; this lets the framework handle "which widget
/// has focus" without per-screen bookkeeping.
class ScreenManager {
public:
    ScreenManager(application::App& app, application::IInputDevice& input);

    /// One-time bring-up. Initialises LVGL, the TFT display, the
    /// flush callback, and the encoder input driver.
    void begin(TFT_eSPI& tft);

    /// Drive one frame: poll input, dispatch to current screen,
    /// re-render if `Router::current()` changed.
    void tick(uint32_t millisNow);

    /// Surface the App for LVGL event callbacks (which are global
    /// functions, not class members, so private member access via
    /// the lambdas isn't possible).
    application::App& app() { return app_; }

private:
    application::App& app_;
    application::IInputDevice& input_;
    domain::ScreenId rendered_ = domain::ScreenId::Boot;
    lv_obj_t* root_ = nullptr;
    lv_group_t* group_ = nullptr;

    // ── per-screen reactive state (kept on the manager so it survives
    //    the screen rebuild on dashboard refresh) ──
    int rotaryDeltaSinceFrame_ = 0;
    bool pressPending_ = false;
    bool longPressPending_ = false;

    void rebuildScreen();
    void teardownScreen();
    void pollAndDispatch();

    // Per-screen builders defined in their respective .cpp files.
    void buildBoot();
    void buildPair();
    void buildDashboard();
    void buildTaskList();
    void buildTaskDetail();
    void buildResultPicker();
    void buildUserPicker();
    void buildSettings();
    void buildSettingsBrightness();
    void buildSettingsAbout();
    void buildWifi();
    void buildWifiConnect();
    void buildLoginQr();
    void buildOfflineNotice();

    // Per-screen event dispatch — called with at most one of:
    // {rotateDelta != 0, press, longPress}.
    void onEvent(int rotateDelta, bool press, bool longPress);
};

}  // namespace howler::screens
