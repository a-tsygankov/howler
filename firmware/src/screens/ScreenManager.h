#pragma once

#include "../application/App.h"
#include "../application/Ports.h"
#include "../domain/LongPressArc.h"
#include "../domain/Router.h"
#include "components/LongPressArcWidget.h"

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
/// Interaction model (matches IInputDevice docs):
///   Press      — tap → enter / activate
///   DoubleTap  — quick double click → back / cancel
///   LongPress  — held past threshold → confirm; the perimeter arc
///                fills as the finger / knob is held so the user has
///                a visual cue
///   Rotate     — knob CW/CCW or touch swipe
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

    /// `screen_dashboard.cpp` reads this to format "in 14m" / "due
    /// 2h" labels relative to the server's idea of "now" (delivered
    /// alongside the dashboard payload). 0 means "we haven't synced
    /// yet" — screens fall back to a static "scheduled" label.
    int64_t lastServerNowSec() const { return lastServerNowSec_; }

private:
    application::App& app_;
    application::IInputDevice& input_;
    domain::ScreenId rendered_ = domain::ScreenId::Boot;
    lv_obj_t* root_ = nullptr;
    lv_group_t* group_ = nullptr;

    /// Owned long-press visual state. The arc widget is rebuilt by
    /// each screen that wants to show it (it lives inside that
    /// screen's LVGL tree); the model is global so the fill survives
    /// the brief reconstruction window.
    domain::LongPressArc longPressArc_;
    components::LongPressArcWidget longPressArcWidget_;
    int64_t lastServerNowSec_ = 0;

    /// Cached pointer to the ResultPicker's big number label so the
    /// rotation-handler in onEvent can refresh it in place without
    /// rebuilding the whole screen tree (which would flicker on
    /// every detent of the encoder). Cleared in teardownScreen().
    lv_obj_t* resultValueLabel_ = nullptr;

    void rebuildScreen();
    void teardownScreen();
    void pollAndDispatch(uint32_t millisNow);

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

    // Per-screen event dispatch — at most one of these is non-zero
    // per call: rotateDelta != 0, tap, doubleTap, longPress.
    void onEvent(int rotateDelta, bool tap, bool doubleTap, bool longPress);
};

}  // namespace howler::screens
