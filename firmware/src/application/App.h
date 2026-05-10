#pragma once

// Top-level app object. Owns the domain models, services, router, and
// (on hardware) the LVGL screens. Stays out of `domain/` so the
// native unit-test build doesn't pull in screen headers.

#include "MarkDoneService.h"
#include "OtaService.h"
#include "PairCoordinator.h"
#include "Ports.h"
#include "SyncService.h"
#include "../domain/DashboardModel.h"
#include "../domain/HomeIdentity.h"
#include "../domain/MarkDoneQueue.h"
#include "../domain/OccurrenceList.h"
#include "../domain/ResultEditModel.h"
#include "../domain/ResultType.h"
#include "../domain/Router.h"
#include "../domain/Settings.h"
#include "../domain/SyncWatermark.h"
#include "../domain/User.h"

#include <cstdint>
#include <string>
#include <vector>

namespace howler::application {

/// Wires everything together. Constructor takes the adapter ports;
/// the firmware-side concrete instances live in main.cpp.
class App {
public:
    App(INetwork& net,
        IPairApi& pairApi,
        IClock& clock,
        IRandom& rng,
        IStorage& storage,
        IInputDevice& input,
        IWifi& wifi,
        ILedRing& led,
        IOtaPort& ota,
        std::string deviceId);

    /// Boot-time setup. Restores queue + settings from storage,
    /// chooses the initial screen (Pair vs Dashboard) based on whether
    /// a device token is present.
    void begin();

    /// Drive one frame: poll input, advance services, refresh screen.
    void tick(uint32_t millisNow);

    // ── Surface for the screens ──────────────────────────────────
    howler::domain::Router& router() { return router_; }
    howler::domain::DashboardModel& dashboard() { return dashboard_; }
    /// All active tasks regardless of urgency tier — what the device's
    /// "All tasks" screen renders. Populated by SyncService from the
    /// same /api/dashboard?include=hidden round-trip that fills
    /// `dashboard()`. The dashboard() model filters HIDDEN out;
    /// allTasks() keeps them.
    howler::domain::DashboardModel& allTasks() { return allTasks_; }
    howler::domain::OccurrenceList& occurrences() { return occList_; }
    const std::vector<howler::domain::User>& users() const { return users_; }
    const std::vector<howler::domain::ResultType>& resultTypes() const { return resultTypes_; }
    /// Home identity (display name + avatar id + tz). Refreshed on
    /// every successful sync round; the screen layer reads this to
    /// render the Settings → About header card with the household
    /// name + avatar instead of just a hex device-id tail.
    const howler::domain::HomeIdentity& homeIdentity() const { return homeIdentity_; }
    howler::domain::Settings& settings() { return settings_; }
    howler::domain::MarkDoneQueue& queue() { return queue_; }
    SyncService& sync() { return sync_; }
    MarkDoneService& markDone() { return markDoneSvc_; }
    PairCoordinator& pair() { return pairCoord_; }
    /// Phase 6 OTA slice F4 — drives the Settings → Check for
    /// updates flow. The screen layer pushes a request via
    /// `requestCheck()` / `requestApply()` and reads `state()` per
    /// frame to surface the corresponding overlay (checking →
    /// update available → downloading → flashed → rebooting).
    OtaService& ota() { return otaSvc_; }
    /// Surface the network + clock ports for components that need
    /// either directly. The IconCache lives on ScreenManager and
    /// composes both — the App is the canonical place to read the
    /// adapter handles, since main.cpp holds them by reference and
    /// nothing else does.
    INetwork& network() { return net_; }
    IClock& clock() { return clock_; }
    /// Server's notion of "now" at the most recent dashboard fetch.
    /// 0 until the first sync round succeeds. Screens render relative
    /// time labels ("in 14 m") from this rather than the local clock.
    int64_t serverNowSec() const { return watermark_.serverNowSec; }
    /// Epoch seconds of the last sync round that completed at least
    /// one successful fetch. 0 until the first round lands. Used by
    /// networkHealth() and the Settings → About screen to show
    /// "last sync 30 s ago" relative to clock.nowEpochSeconds().
    int64_t lastFullSyncSec() const { return watermark_.lastFullSync; }

    /// Network state classifier for the offline-indicator UX. Three
    /// degrees of degradation, ordered by severity:
    ///
    ///   Fresh       — network adapter reports online AND the last
    ///                 successful sync was within `kStaleAfterSec`.
    ///                 No indicator on the dashboard; LED ring shows
    ///                 the urgency-tier ambient.
    ///   Stale       — network is online but the last successful
    ///                 sync is older than the threshold (server may
    ///                 be unreachable, slow, or our token expired).
    ///                 Dashboard shows a small refresh-warn badge;
    ///                 LED ring stays on the urgency-tier ambient
    ///                 because the data we have is still authoritative.
    ///   Offline     — the network adapter itself reports !isOnline
    ///                 (Wi-Fi association lost or never connected,
    ///                 or pairing token missing). Dashboard shows an
    ///                 explicit offline badge; LED ring switches to
    ///                 a dim cool-tone ambient so the user notices
    ///                 even from across the room.
    enum class NetworkHealth { Fresh, Stale, Offline };
    NetworkHealth networkHealth() const;

    /// Toggle the active theme + persist to NVS in one step. The
    /// caller (Settings carousel handler) follows up with a screen
    /// rebuild so the new palette takes effect.
    void toggleTheme();
    /// Force-set the theme; persists to NVS. Same caveat as
    /// toggleTheme — caller refreshes the screen.
    void setTheme(howler::domain::Theme t);
    const std::string& deviceId() const { return deviceId_; }
    IStorage& storage() { return storage_; }
    IWifi& wifi() { return wifi_; }
    const std::vector<howler::domain::WifiNetwork>& wifiScan() const { return wifiScan_; }
    /// Trigger a fresh Wi-Fi scan (blocking on the supplicant). The
    /// Wi-Fi screen calls this on entry; the result populates
    /// `wifiScan()`. Returns false on driver failure.
    bool refreshWifiScan();
    /// Persist creds to NVS and attempt a connect. Returns the result
    /// of the connect attempt; the caller decides whether to push the
    /// "connecting" screen or surface an error.
    bool saveAndConnectWifi(const howler::domain::WifiConfig& cfg);

    // ── Mark-done helpers consumed by the UserPicker / ResultPicker ──
    /// Pre-filled draft the flow accumulates while the user steps
    /// through the pickers. Cleared on commit / cancel.
    struct PendingDone {
        howler::domain::TaskId taskId;
        std::string occurrenceId;
        std::string resultTypeId;
        bool        hasResultValue = false;
        double      resultValue = 0.0;
        std::string userId;
    };
    PendingDone& pendingDone() { return pendingDone_; }
    const PendingDone& pendingDone() const { return pendingDone_; }
    void clearPendingDone() { pendingDone_ = {}; }

    /// In-progress numeric result editor for the result picker. Mode
    /// transitions: `prepareResultEdit()` seeds it from the selected
    /// task's result type + last-known execution value, then the
    /// screen drives `nudge()` from rotation events; `commit()` is
    /// implicit when the user taps to advance. Pure value type;
    /// safe to keep on the App across screen rebuilds.
    howler::domain::ResultEditModel& resultEdit() { return resultEdit_; }

    /// Look up the result type matching `id` from the synced list.
    /// Returns nullptr if not found (defensive — should never fire
    /// if the dashboard payload was consistent with /api/task-results).
    const howler::domain::ResultType* findResultType(const std::string& id) const;

    /// Snapshot of the last execution value for a given task, used to
    /// pre-seed the result picker. Read from the per-task last-value
    /// cache that SyncService populates alongside the dashboard fetch
    /// (we use the dashboard's own last-execution lookup; if it isn't
    /// available the picker falls back to the type's default/min).
    bool lastValueForTask(const howler::domain::TaskId& id, double& outValue) const;

    /// Cache the last numeric result for `taskId`. Called after every
    /// successful commitPendingDone so the next picker pre-fills with
    /// the value the user just entered. Bounded to ~32 entries; older
    /// entries fall off so this can't grow unbounded.
    void rememberLastValue(const howler::domain::TaskId& id, double value);

    /// Commit the accumulated pendingDone — enqueues + drops the
    /// dashboard row optimistically. Caller decides what to do with
    /// the screen stack afterwards (typically pop back to dashboard).
    void commitPendingDone();

private:
    INetwork& net_;
    IPairApi& pairApi_;
    IClock& clock_;
    IRandom& rng_;
    IStorage& storage_;
    IInputDevice& input_;
    IWifi& wifi_;
    ILedRing& led_;
    IOtaPort& ota_;
    std::vector<howler::domain::WifiNetwork> wifiScan_;

    howler::domain::Router router_;
    howler::domain::DashboardModel dashboard_;
    howler::domain::DashboardModel allTasks_;
    howler::domain::OccurrenceList occList_;
    howler::domain::MarkDoneQueue queue_;
    howler::domain::Settings settings_;
    howler::domain::SyncWatermark watermark_;
    howler::domain::HomeIdentity homeIdentity_;
    std::vector<howler::domain::User> users_;
    std::vector<howler::domain::ResultType> resultTypes_;
    PendingDone pendingDone_;

    SyncService sync_;
    MarkDoneService markDoneSvc_;
    PairCoordinator pairCoord_;
    OtaService otaSvc_;

    howler::domain::ResultEditModel resultEdit_;

    /// Bounded cache of last entered values per task. Pairs of
    /// (taskHex, value); flush oldest on overflow.
    struct LastValue {
        std::string taskHex;
        double      value;
    };
    static constexpr size_t kLastValueCap = 32;
    std::vector<LastValue> lastValues_;

    std::string deviceId_;

    void restoreSettings();
    void persistSettings();
};

}  // namespace howler::application
