#pragma once

#include <cstdint>

namespace howler::domain {

/// One per logical entity collection. Stored in NVS and bumped each
/// sync round to the max(updatedAt) we observed. Sending it back on
/// the next sync lets the server return only deltas — until that
/// endpoint exists we still send the watermark and the server-side
/// fall-through is "ignore and return everything", which is correct.
struct SyncWatermark {
    int64_t users         = 0;
    int64_t resultTypes   = 0;
    int64_t dashboard     = 0;     // max updated_at across rendered tasks
    int64_t lastFullSync  = 0;     // when the last full round completed
};

}  // namespace howler::domain
