#pragma once

// Top-level app object. Owns the domain models, services, router, and
// (on hardware) the LVGL screens. Stays out of `domain/` so the
// native unit-test build doesn't pull in screen headers.

#include "MarkDoneService.h"
#include "PairCoordinator.h"
#include "Ports.h"
#include "SyncService.h"
#include "../domain/DashboardModel.h"
#include "../domain/MarkDoneQueue.h"
#include "../domain/OccurrenceList.h"
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
    howler::domain::OccurrenceList& occurrences() { return occList_; }
    const std::vector<howler::domain::User>& users() const { return users_; }
    const std::vector<howler::domain::ResultType>& resultTypes() const { return resultTypes_; }
    howler::domain::Settings& settings() { return settings_; }
    howler::domain::MarkDoneQueue& queue() { return queue_; }
    SyncService& sync() { return sync_; }
    MarkDoneService& markDone() { return markDoneSvc_; }
    PairCoordinator& pair() { return pairCoord_; }
    const std::string& deviceId() const { return deviceId_; }
    IStorage& storage() { return storage_; }

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

    howler::domain::Router router_;
    howler::domain::DashboardModel dashboard_;
    howler::domain::OccurrenceList occList_;
    howler::domain::MarkDoneQueue queue_;
    howler::domain::Settings settings_;
    howler::domain::SyncWatermark watermark_;
    std::vector<howler::domain::User> users_;
    std::vector<howler::domain::ResultType> resultTypes_;
    PendingDone pendingDone_;

    SyncService sync_;
    MarkDoneService markDoneSvc_;
    PairCoordinator pairCoord_;

    std::string deviceId_;

    void restoreSettings();
    void persistSettings();
};

}  // namespace howler::application
