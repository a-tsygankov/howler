#pragma once

#include "TaskId.h"
#include <cstdint>
#include <string>

namespace howler::domain {

enum class OccurrenceStatus : uint8_t { Pending, Acked, Skipped, Missed };

/// What the device renders. Mirrors the server's OCCURRENCE row but
/// only the fields the screens actually use. Pure data — comparison
/// and sorting (priority, due time) live in OccurrenceList.
struct Occurrence {
    std::string id;       // 32-hex
    TaskId      taskId;
    std::string title;
    uint8_t     priority;     // 0..3
    int64_t     dueAt;        // epoch seconds; <0 means "no fixed time"
    OccurrenceStatus status;
};

}  // namespace howler::domain
