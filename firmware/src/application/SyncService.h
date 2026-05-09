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
                howler::domain::DashboardModel& allTasks,
                std::vector<howler::domain::User>& users,
                std::vector<howler::domain::ResultType>& resultTypes,
                howler::domain::SyncWatermark& watermark)
        : net_(net), clock_(clock),
          occList_(occList), dashboard_(dashboard), allTasks_(allTasks),
          users_(users), resultTypes_(resultTypes),
          watermark_(watermark) {}

    /// Call from the main loop. No-op when offline or when the
    /// `intervalMs_` cool-down hasn't elapsed.
    void tick();

    /// Force a full sync on the next tick, regardless of cool-down
    /// AND regardless of the peek-counter equality skip. Used after
    /// the user mark-dones a task so the dashboard picks up the
    /// change as soon as the network is available, and after the
    /// SyncService is constructed so the very first tick fetches
    /// data instead of trusting an uninitialised peek result.
    void requestSync() {
        lastPollMs_ = INT64_MIN / 2;
        forceNextRound_ = true;
    }

    void setIntervalMs(uint32_t ms) { intervalMs_ = ms; }
    /// Force a full refresh after this much wall-clock time even
    /// when the peek counter is unchanged. With slice B (local
    /// urgency) landed, the counter is authoritative for *all*
    /// device-visible state changes — there's no longer a
    /// drift-without-write scenario the periodic refresh has to
    /// cover. The default is now 1 h as defense-in-depth: in the
    /// unlikely event that a future home-scoped table mutates
    /// without firing a counter trigger, the device still picks up
    /// the change within an hour instead of indefinitely.
    void setFullRefreshIntervalMs(uint32_t ms) { fullRefreshMs_ = ms; }
    bool lastSyncOk() const { return lastSyncOk_; }
    /// Cached counter from the most recent successful peek (or full
    /// round). Exposed for the About diagnostic readout — the
    /// device can show "counter X" alongside sync age so the user
    /// can spot peek-loop behaviour at a glance. 0 means "not yet
    /// peeked or full-synced this boot".
    int64_t lastCounter() const { return lastCounter_; }

private:
    INetwork& net_;
    IClock& clock_;
    howler::domain::OccurrenceList& occList_;
    howler::domain::DashboardModel& dashboard_;
    howler::domain::DashboardModel& allTasks_;
    std::vector<howler::domain::User>& users_;
    std::vector<howler::domain::ResultType>& resultTypes_;
    howler::domain::SyncWatermark& watermark_;

    int64_t lastPollMs_ = INT64_MIN / 2;
    /// Wall-clock millis of the last full (four-fetch) round, used
    /// by the periodic refresh stopgap. INT64_MIN/2 means "never".
    int64_t lastFullRoundMs_ = INT64_MIN / 2;
    /// Cached home update_counter; -1 = never peeked. SyncService
    /// compares incoming peek counters against this; equal +
    /// inside the full-refresh window = skip the four fetches.
    int64_t lastCounter_ = -1;
    uint32_t intervalMs_ = 30000;
    /// Default 1 h — see setFullRefreshIntervalMs. Slice B raised
    /// the cadence from the slice-A 5-min urgency-drift stopgap;
    /// counter peek is now authoritative on the hot path.
    uint32_t fullRefreshMs_ = 60u * 60u * 1000u;
    /// Set by requestSync(); cleared at the top of runRoundIfNeeded
    /// after we've decided to do a full round. Lets external callers
    /// punch through the peek skip without poking private state.
    bool forceNextRound_ = false;
    bool lastSyncOk_ = false;

    void runRound();
    /// Decide path for one tick: peek first; on counter equality
    /// inside the refresh window, return without fetching. Otherwise
    /// run a full round. Pulled out of `tick()` so it's testable in
    /// isolation.
    bool runRoundIfNeeded();
};

}  // namespace howler::application
