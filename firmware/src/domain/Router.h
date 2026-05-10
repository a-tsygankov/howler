#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace howler::domain {

/// Identifies a screen. The actual screen objects live in the
/// `screens/` LVGL layer; the Router is pure so it can be unit-tested
/// without LVGL. Order isn't significant — IDs are stable so storage
/// can persist a back-stack across a sleep/wake cycle if we want.
enum class ScreenId : uint8_t {
    Boot,
    Pair,
    Dashboard,
    TaskList,
    TaskDetail,
    ResultPicker,
    UserPicker,
    Settings,
    SettingsBrightness,
    SettingsAbout,
    SettingsTheme,
    /// Phase 6 OTA F4 — "Check for updates" sub-screen of Settings.
    /// Drives an OtaService::requestCheck on entry, surfaces the
    /// state machine's progress, and lets the user kick off the
    /// download + flash with a single tap when an advisory lands.
    SettingsUpdates,
    Wifi,
    WifiConnect,
    LoginQr,
    OfflineNotice,
};

/// Navigation graph. Push/pop preserves the back-stack; replace clears
/// it (used when the dashboard becomes the new "root" after pairing).
class Router {
public:
    Router() : stack_{ScreenId::Boot} {}

    ScreenId current() const { return stack_.back(); }

    void push(ScreenId s) { stack_.push_back(s); }

    /// Pop one entry. Returns false at root (the screen should treat
    /// this as "no-op" — caller decides whether long-press at root
    /// opens settings or just stays).
    bool pop() {
        if (stack_.size() <= 1) return false;
        stack_.pop_back();
        return true;
    }

    /// Drop the entire back-stack and make `s` the only entry. Used
    /// after pairing succeeds (Dashboard becomes the new root) and on
    /// "unpair" (Pair becomes the new root again).
    void replaceRoot(ScreenId s) {
        stack_.clear();
        stack_.push_back(s);
    }

    /// True if the current screen is the back-stack root — a long-press
    /// at root is "open settings", not "back".
    bool atRoot() const { return stack_.size() == 1; }

    size_t depth() const { return stack_.size(); }

    /// Snapshot for tests — order = oldest first.
    const std::vector<ScreenId>& stack() const { return stack_; }

private:
    std::vector<ScreenId> stack_;
};

}  // namespace howler::domain
