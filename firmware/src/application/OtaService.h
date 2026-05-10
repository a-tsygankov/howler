#pragma once

// Phase 6 OTA slice F4 — application-side state machine driving the
// dial's self-update flow. Owns the IOtaPort adapter; the screen
// layer reads `state()` + `progressPercent()` per frame and
// surfaces a corresponding overlay.
//
// Lifecycle:
//
//   Idle ──requestCheck()──→ Checking
//   Checking ──no update────→ UpToDate
//   Checking ──advisory─────→ UpdateAvailable      (advisory_ filled)
//   Checking ──net error────→ Failed               (errorMessage_ filled)
//   UpdateAvailable ──requestApply()──→ Downloading
//   Downloading ──ok──→ Flashed                    (waits ~1 s, then reboots)
//   Downloading ──fail─→ Failed
//   Flashed ──tick + grace period──→ Rebooting     (calls IOtaPort::reboot)
//   * (any) ──requestCheck()──→ Checking           (resets transient state)
//
// Defense-in-depth: even when the server says "update available"
// with version V, OtaService re-runs `compareVersions(V, current)`
// locally and rejects V <= current. A stale rollout rule pinning
// the device to an OLDER build can't accidentally downgrade us.

#include "Ports.h"
#include "../domain/UpdateAdvisory.h"

#include <cstdint>
#include <string>

namespace howler::application {

class OtaService {
public:
    enum class State : uint8_t {
        Idle,
        Checking,
        UpdateAvailable,
        Downloading,
        Flashed,
        UpToDate,
        Failed,
    };

    OtaService(INetwork& net, IOtaPort& ota, IClock& clock,
               std::string fwVersion)
        : net_(net), ota_(ota), clock_(clock),
          fwVersion_(std::move(fwVersion)) {}

    /// Poll once per frame from App::tick. Drains the request flags
    /// and runs at most one blocking transition (check or flash) per
    /// call so we don't starve the LVGL frame budget more than
    /// needed.
    void tick();

    /// Request an advisory check. Idempotent — a re-press while
    /// a check is in flight or already-resolved is harmless.
    void requestCheck();

    /// Begin downloading + flashing the most recent advisory. No-op
    /// when state != UpdateAvailable. Caller is expected to gate
    /// the button on state.
    void requestApply();

    /// Cancel any in-flight or finished flow and return to Idle.
    /// Used by the screen layer when the user dismisses the
    /// "Check for updates" detail screen — we don't want a stale
    /// "UpToDate" state lingering until next boot.
    void reset();

    State state() const { return state_; }
    const howler::domain::UpdateAdvisory& advisory() const { return advisory_; }
    /// 0..100 during Downloading, undefined otherwise. -1 means the
    /// adapter didn't report progress (indeterminate spinner UX).
    int progressPercent() const { return progressPct_; }
    const std::string& errorMessage() const { return errorMsg_; }
    /// True when the bootloader committed the flashed image and is
    /// waiting on a "good" signal before committing it permanently
    /// (slice F5). Surfaced from IOtaPort::isPendingVerify so the
    /// pending-verify check can run on early boot regardless of
    /// whether a check is in flight right now.
    bool isPendingVerify() const { return ota_.isPendingVerify(); }

    /// Slice F5 — call this once a sync round confirms the new
    /// build is talking to the server, so the bootloader cancels
    /// the auto-rollback. Forwarded directly to the adapter.
    void markRunningBuildValid() { ota_.markValid(); }

    /// Surface the version string the service was constructed with —
    /// the screen layer uses this to render "now: 0.3.0 → 0.4.0".
    const std::string& currentVersion() const { return fwVersion_; }

private:
    INetwork& net_;
    IOtaPort& ota_;
    IClock& clock_;
    std::string fwVersion_;

    State state_ = State::Idle;
    bool checkRequested_ = false;
    bool applyRequested_ = false;
    int progressPct_ = -1;
    int64_t flashedAtMs_ = 0;
    /// Wait this long between the flash succeeding and triggering
    /// the reboot, so the LCD has time to repaint "rebooting..." and
    /// the user sees a confirmation beat before the screen blanks.
    static constexpr int64_t kRebootGraceMs = 1500;

    howler::domain::UpdateAdvisory advisory_;
    std::string errorMsg_;

    void runCheck();
    void runApply();
    static const char* mapOtaError(IOtaPort::Result r);
};

}  // namespace howler::application
