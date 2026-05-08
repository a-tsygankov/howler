#pragma once

#include "../application/App.h"
#include "../application/Ports.h"
#include "../domain/LongPressArc.h"
#include "../domain/RoundMenuModel.h"
#include "../domain/Router.h"
#include "components/DrumScroller.h"
#include "components/IconCache.h"
#include "components/LongPressArcWidget.h"
#include "components/RoundMenu.h"
#include "components/ValueWidget.h"
#include "components/TaskCard.h"

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

    /// True iff the bottom-most screen in the router stack is
    /// TaskList. Used by Settings → "Switch view" to decide which
    /// way to flip the root.
    bool isOnTaskListRoot() const;

    /// Brief banner overlay that fades after `durationMs`. Used to
    /// surface "syncing..." after the user taps Sync now in Settings.
    /// Lives outside the screen tree so it survives screen rebuilds.
    void showToast(const char* text, uint32_t durationMs = 1500);

    /// Force a screen rebuild on the next tick even when the active
    /// router id hasn't changed. Used by handlers that change visual
    /// state without navigating — e.g. the Theme toggle in Settings,
    /// which flips the palette and needs the current screen to
    /// re-render with the new colours.
    void requestRebuild() { rebuildPending_ = true; }

    /// Show a brief green-checkmark animation over whatever is on
    /// screen. Used after a mark-done so the user sees a clear
    /// "task confirmed" beat before the row drops out. The screen
    /// stays interactive but the checkmark sits above on the top
    /// layer; it fades on its own after `durationMs`.
    void playDoneAnimation(uint32_t durationMs = 900);

    /// Helper for screens that show a tab strip — returns the index
    /// of the current main screen in `kMainScreens`, or kMainScreens
    /// length if the current screen isn't a main one.
    size_t mainScreenIndex() const;

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
    /// rebuilding the whole screen tree. Kept for backwards
    /// compatibility — the new specialised value widgets drive
    /// updates through `valueWidget_` instead. Cleared in
    /// teardownScreen().
    lv_obj_t* resultValueLabel_ = nullptr;

    /// Active ResultPicker value widget (numeric, stars, bowl, clock,
    /// ruler — whichever the unit name selects). Recreated on every
    /// ResultPicker entry by `buildResultPicker`; reset to nullptr
    /// in `teardownScreen` so the LVGL pointers it owns don't outlive
    /// the parent root_.
    std::unique_ptr<components::ValueWidget> valueWidget_;

    /// Toast overlay (parent = lv_layer_top so it floats above any
    /// screen tree and survives router transitions). Used by
    /// Settings → "Sync now" to surface "syncing..." for ~1.5 s.
    lv_obj_t* toastLabel_ = nullptr;
    uint32_t  toastUntilMs_ = 0;

    /// Done-animation overlay: green check on the top layer that
    /// fades in + scales up briefly when `playDoneAnimation()` fires.
    /// Auto-cleaned in tick() once `doneUntilMs_` passes.
    lv_obj_t* doneOverlay_ = nullptr;
    uint32_t  doneUntilMs_ = 0;

    /// Set by handlers that mutate visual state without changing the
    /// router. Read + cleared in tick().
    bool rebuildPending_ = false;

    /// Round-menu state. Each screen that opts into the watch-style
    /// carousel layout (Settings, UserPicker, Wi-Fi) populates the
    /// model with items + an activate callback during build*; the
    /// ScreenManager event router translates rotation/tap into
    /// `menu_.onRotate()` / `menu_.fireActivate()`. The model lives
    /// here so cursor doesn't reset when an inner screen pops back
    /// to its caller.
    domain::RoundMenuModel menuModel_;
    components::RoundMenu  menu_;
    /// True between build* and teardown for screens that registered
    /// menu_ — ScreenManager::onEvent reads this to decide whether
    /// to forward events to the menu.
    bool menuActive_ = false;

    /// Shared drum scroller for the Dashboard + TaskList three-up
    /// (selected detailed card + neighbour minis sliding on tier
    /// rotations). Built fresh by `buildDashboard` / `buildTaskList`;
    /// subsequent cursor changes drive scrollBy() WITHOUT a full
    /// screen rebuild so the inertial slide animation actually plays.
    components::DrumScroller taskDrum_;
    bool                     taskDrumActive_ = false;
    /// Cursor-dots label inside the same task screens — needs an
    /// in-place text update on each scroll because the surrounding
    /// chrome (tab strip, tier counts, footer hint) doesn't rebuild
    /// while the drum animates.
    lv_obj_t*                taskCursorDots_ = nullptr;

    /// Cached generation snapshot of the dashboard / all-tasks model
    /// at the time the current screen was built. tick() compares the
    /// live generation each frame and triggers a screen rebuild when
    /// it changes — that's the path by which a sync round's data
    /// refresh propagates to the rendered drum without requiring the
    /// user to scroll first. We track both even when only one screen
    /// is rendered so that a navigation back to the other surfaces
    /// the latest data.
    uint32_t                 lastDashboardGen_ = 0;
    uint32_t                 lastAllTasksGen_  = 0;
    /// Same idea for the icon cache — when an async prefetch lands a
    /// new bitmap, the active drum-screen rebuilds so any avatar
    /// previously showing a fallback glyph now renders the icon.
    uint32_t                 lastIconCacheGen_ = 0;
    /// One-shot flag — flips true the first time we observe the
    /// network as online AND prewarm the icon cache with the full
    /// LABEL_ICON_CHOICES set. Subsequent online/offline cycles
    /// don't re-prewarm; the cache's TTL already covers refreshing
    /// stale entries.
    bool                     iconCachePrewarmed_ = false;

    /// LRU cache of icon bitmaps fetched from /api/icons/:name. Lives
    /// here (not on App) so the LVGL types it owns (lv_image_dsc_t)
    /// don't bleed into the application layer. Wired into the task
    /// drum's render closure so each detail / mini avatar looks up
    /// its icon by name on every rebuild — cheap because the cache
    /// is in PSRAM and the bitmap is 72 bytes.
    components::IconCache    iconCache_;
    /// Stable lookup-fn handle the render closures pass into
    /// buildStatusAvatar — pre-bound to iconCache_ so we don't
    /// allocate per-render.
    components::IconLookupFn iconLookup_;

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
    void buildSettingsTheme();
    void buildWifi();
    void buildWifiConnect();
    void buildLoginQr();
    void buildOfflineNotice();

    /// Per-screen event dispatch. `vertSwipe` and `horzSwipe` are
    /// +1/-1 for the corresponding direction (or 0 if not present).
    /// At root, knob rotation AND horizontal swipe cycle the main
    /// pills; vertical swipe scrolls the current screen's content
    /// cursor. Off-root, knob rotation cycles the menu cursor and
    /// taps activate.
    void onEvent(int rotateDelta, bool tap, bool doubleTap, bool longPress,
                 int vertSwipe, int horzSwipe);

    /// The list of "main" screens the user can swipe between at root
    /// level. Order = the swipe-left / knob-CW cycle direction.
    /// Pair is excluded — it's a setup screen, not a main one.
    static constexpr domain::ScreenId kMainScreens[] = {
        domain::ScreenId::Dashboard,
        domain::ScreenId::TaskList,
        domain::ScreenId::Settings,
    };
};

}  // namespace howler::screens
