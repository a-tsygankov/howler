#pragma once

#include "Ports.h"
#include "../domain/MarkDoneDraft.h"
#include "../domain/MarkDoneQueue.h"

namespace howler::application {

/// Owns the offline-tolerant outbound queue. UI calls `enqueue()`
/// when the user presses Done; the service drains the queue every
/// `tick()` while online. A successful `Permanent` rejection (e.g.,
/// 4xx — bad payload, removed task) drops the entry so we don't
/// retry forever.
class MarkDoneService {
public:
    MarkDoneService(INetwork& net,
                    IClock& clock,
                    IRandom& rng,
                    IStorage& storage,
                    howler::domain::MarkDoneQueue& queue);

    /// Build and enqueue a draft. Generates the executionId, stamps
    /// `ts` from the clock, persists the queue snapshot. Returns the
    /// generated id so the UI can reflect the optimistic state.
    std::string enqueue(const howler::domain::TaskId& taskId,
                        const std::string& occurrenceId,
                        const std::string& userId,
                        bool hasResultValue,
                        double resultValue);

    /// Drain one entry from the queue if conditions allow. Called from
    /// the main loop. Bounded work-per-tick: at most one HTTP roundtrip,
    /// to keep the LVGL frame budget healthy.
    void tick();

    bool empty() const { return queue_.empty(); }
    size_t pending() const { return queue_.size(); }

    /// Restore from NVS at boot. Format: simple TLV — see
    /// serialize/deserialize at the bottom.
    void restoreFromStorage();

    /// Push the current snapshot to NVS.
    void persistToStorage();

    static std::string serialize(const howler::domain::MarkDoneQueue& q);
    static bool deserialize(const std::string& bytes, howler::domain::MarkDoneQueue& out);

private:
    INetwork& net_;
    IClock& clock_;
    IRandom& rng_;
    IStorage& storage_;
    howler::domain::MarkDoneQueue& queue_;
    int64_t lastAttemptMs_ = 0;
    /// Backoff after a transient error: at most one retry every 5 s.
    /// Avoids hammering the worker when it's flaky.
    static constexpr int64_t kBackoffMs = 5000;
};

}  // namespace howler::application
