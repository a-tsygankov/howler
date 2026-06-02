#pragma once

#include <cstdint>
#include <string>

namespace howler::domain {

enum class Theme : uint8_t { Light = 0, Dark = 1 };

/// User-tweakable device settings. Persisted to NVS by the storage
/// adapter; the application layer treats this as a value type and
/// reads/writes whole snapshots.
struct Settings {
    /// Display brightness: 0..255 (255 = full).
    uint8_t brightness = 200;

    /// Foreground sync interval. Background sync (when the screen is
    /// off) is fixed at 5 minutes — this slider only controls how
    /// often the dashboard refreshes while the user is interacting.
    uint16_t foregroundSyncSec = 30;

    /// Light or dark palette. The webapp matches via its own
    /// localStorage flag; the device persists this in NVS so the
    /// user's choice survives reboot. Default: Light (warm-domestic
    /// palette as on the webapp's home theme).
    Theme theme = Theme::Light;

    /// IANA tz name (e.g. "America/Los_Angeles") learned from the
    /// home record on first sync. Empty means UTC fallback.
    std::string homeTz;

    /// Visible name set by the user during pairing (or default
    /// "Howler-<last4>" using the device id).
    std::string deviceName;

    /// Idle timeout: after this many seconds without user input, the
    /// device dims the backlight + mutes the LED ring (a "screen
    /// sleep" — not full deep-sleep, the radio stays up so the device
    /// can still receive push events). 0 = disabled (screen always
    /// on). Default 300 s (5 min) — picks a middle ground between
    /// the user's "5-10 min" request; configurable via the
    /// Settings → Sleep picker.
    ///
    /// True deep-sleep is a follow-up: it requires careful peripheral
    /// teardown (Wi-Fi, LVGL, the rotary ISR) and an `ext0` wake
    /// pin map, which the captive-portal flow also needs. For now
    /// the screen-sleep covers ~70% of the power saving (the LED ring
    /// + backlight dominate the steady-state draw).
    uint16_t idleTimeoutSec = 300;
};

}  // namespace howler::domain
