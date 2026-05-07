#pragma once

#include "TaskId.h"
#include <cstdint>
#include <string>

namespace howler::domain {

enum class Urgency : uint8_t { Urgent, NonUrgent };

/// One dashboard row — `Occurrence`-shaped where present, otherwise
/// "open task" (no due time, no occurrence id). The device renders
/// dashboards from this; the wire format is server-resolved (see
/// /api/dashboard) so the urgency rule lives in one place.
///
/// `occurrenceId` empty means "no live occurrence — completing this
/// row is a direct task-execution, not an occurrence ack".
struct DashboardItem {
    std::string id;            // stable: occurrenceId if set, else taskId
    TaskId      taskId;
    std::string occurrenceId;  // empty for ack-less direct completion
    std::string title;
    std::string avatarId;      // opaque — display layer handles fallbacks
    std::string resultTypeId;  // empty if task has no result type
    Urgency     urgency;
    uint8_t     priority;      // 0..3
    int64_t     dueAt;         // epoch seconds; <0 means "no fixed time"
    bool        isMissed;
    int64_t     updatedAt;     // epoch seconds — sync watermark
};

}  // namespace howler::domain
