#pragma once

#include "Ports.h"
#include "../domain/OccurrenceList.h"

namespace howler::application {

/// Phase 0: REST polling. Phase 3 swaps the INetwork adapter to MQTT
/// (plan §10) — this class doesn't change.
class SyncService {
public:
    SyncService(INetwork& net, IClock& clock, howler::domain::OccurrenceList& list)
        : net_(net), clock_(clock), list_(list) {}

    /// Call from the main loop. Polls when due; updates the list.
    void tick();

    void setIntervalMs(uint32_t ms) { intervalMs_ = ms; }

private:
    INetwork& net_;
    IClock& clock_;
    howler::domain::OccurrenceList& list_;
    int64_t lastPollMs_ = 0;
    uint32_t intervalMs_ = 5000;
};

}  // namespace howler::application
