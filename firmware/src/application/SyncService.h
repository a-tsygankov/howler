#pragma once

#include "Ports.h"
#include "../domain/DashboardModel.h"
#include "../domain/OccurrenceList.h"
#include "../domain/ResultType.h"
#include "../domain/SyncWatermark.h"
#include "../domain/User.h"

#include <vector>

namespace howler::application {

/// Round-trip the four read endpoints: dashboard (urgent/non-urgent
/// rows), users (for the post-done picker), result types (for the
/// post-done picker), and the legacy /occurrences/pending feed (kept
/// in place so the existing test still compiles and so we have a
/// fallback when the dashboard endpoint isn't reachable).
///
/// Watermark is bumped after each successful fetch so subsequent
/// rounds can ask for deltas only — and so a sync after a long sleep
/// knows whether full data is fresh enough to skip re-fetching.
///
/// Phase 0 was REST polling. Phase 3 swaps the INetwork adapter to
/// MQTT (plan §10) — this class doesn't change.
class SyncService {
public:
    SyncService(INetwork& net,
                IClock& clock,
                howler::domain::OccurrenceList& occList,
                howler::domain::DashboardModel& dashboard,
                std::vector<howler::domain::User>& users,
                std::vector<howler::domain::ResultType>& resultTypes,
                howler::domain::SyncWatermark& watermark)
        : net_(net), clock_(clock),
          occList_(occList), dashboard_(dashboard),
          users_(users), resultTypes_(resultTypes),
          watermark_(watermark) {}

    /// Call from the main loop. No-op when offline or when the
    /// `intervalMs_` cool-down hasn't elapsed.
    void tick();

    /// Force a sync on the next tick, regardless of cool-down. Used
    /// after the user mark-dones a task so the dashboard picks up
    /// the change as soon as the network is available.
    void requestSync() { lastPollMs_ = INT64_MIN / 2; }

    void setIntervalMs(uint32_t ms) { intervalMs_ = ms; }
    bool lastSyncOk() const { return lastSyncOk_; }

private:
    INetwork& net_;
    IClock& clock_;
    howler::domain::OccurrenceList& occList_;
    howler::domain::DashboardModel& dashboard_;
    std::vector<howler::domain::User>& users_;
    std::vector<howler::domain::ResultType>& resultTypes_;
    howler::domain::SyncWatermark& watermark_;

    int64_t lastPollMs_ = INT64_MIN / 2;
    uint32_t intervalMs_ = 30000;
    bool lastSyncOk_ = false;

    void runRound();
};

}  // namespace howler::application
