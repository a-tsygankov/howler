#pragma once

#include "TaskId.h"
#include <cstdint>
#include <string>

namespace howler::domain {

/// One pending mark-done. Server is keyed off `executionId` (32-hex
/// UUID, generated client-side) so retries are idempotent — the
/// backend treats `INSERT OR IGNORE` on the primary key as "this
/// retry already won, no-op" (see backend/src/routes/tasks.ts:362
/// and the webapp's executionQueue for the analogous flow).
///
/// `occurrenceId` empty → call `/tasks/:taskId/complete` instead of
/// `/occurrences/:id/ack`. (Direct completion exists for tasks the
/// dial wants to mark done outside the cron→queue pipeline.)
///
/// `userId` empty → don't attribute (the user picked "skip").
/// `hasResultValue` false → don't send a value (skipped).
struct MarkDoneDraft {
    std::string executionId;   // 32-hex UUID
    TaskId      taskId;
    std::string occurrenceId;  // optional
    std::string userId;        // optional
    bool        hasResultValue;
    double      resultValue;
    std::string notes;         // currently always empty; reserved for the future
    int64_t     ts;            // epoch seconds — when the user pressed Done
    uint16_t    attempts;      // monotonically incremented on each send attempt
};

}  // namespace howler::domain
