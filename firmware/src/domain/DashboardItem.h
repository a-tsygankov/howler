#pragma once

#include "TaskId.h"
#include <cstdint>
#include <string>
#include <vector>

namespace howler::domain {

/// Urgency tier for a dashboard row. Slice B (docs/sync-analysis.md)
/// switches the device from server-resolved urgency (read once per
/// sync round, drifts in-between) to a per-frame local computation
/// driven by `computeUrgency()` over the rule + anchor fields below.
/// The dashboard endpoint still emits a server-computed snapshot so
/// the webapp keeps working untouched, but the device ignores it
/// when the rule + anchors are present.
enum class Urgency : uint8_t { Urgent, NonUrgent, Hidden };

/// One dashboard row — `Occurrence`-shaped where present, otherwise
/// "open task" (no due time, no occurrence id). The device renders
/// dashboards from this.
///
/// `occurrenceId` empty means "no live occurrence — completing this
/// row is a direct task-execution, not an occurrence ack".
///
/// Slice B fields (`ruleKind`, `dailyMinutes`, `intervalDays`,
/// `scheduleModifiedAt`, `oneshotDeadline`, `lastExecutionAt`)
/// carry the inputs the on-device `computeUrgency()` needs. Negative
/// values play TS `null` per the Urgency.h sentinel convention.
/// `hasRule` is false when the server didn't send a rule (older
/// payloads or fetch parse error) — render code falls back to the
/// server snapshot in that case.
struct DashboardItem {
    std::string id;            // stable: occurrenceId if set, else taskId
    TaskId      taskId;
    std::string occurrenceId;  // empty for ack-less direct completion
    std::string title;
    std::string avatarId;      // opaque — display layer handles fallbacks
    std::string resultTypeId;  // empty if task has no result type
    Urgency     urgency;       // server snapshot — slice B fallback only
    uint8_t     priority;      // 0..3
    int64_t     dueAt;         // epoch seconds; <0 means "no fixed time"
    bool        isMissed;      // server snapshot — slice B fallback only
    int64_t     updatedAt;     // epoch seconds — sync watermark

    // ── Slice B local-urgency inputs ─────────────────────────────
    /// True iff the wire response carried a parseable `rule` object
    /// AND `scheduleModifiedAt`. Render code: with `hasRule = true`
    /// run `computeUrgency()`; with false fall back to the server
    /// snapshot above.
    bool                  hasRule           = false;
    /// 0 = DAILY, 1 = PERIODIC, 2 = ONESHOT (matches
    /// ScheduleRule::Kind ordering).
    uint8_t               ruleKind          = 0;
    /// DAILY only: minute-of-day for each scheduled slot. Order is
    /// arbitrary; computeUrgency sorts a local copy.
    std::vector<uint16_t> dailyMinutes;
    /// PERIODIC: required cadence. ONESHOT: optional cadence (0 =
    /// no reminders). Unused for DAILY.
    int32_t               intervalDays      = 0;
    /// Schedule's `rule_modified_at` in epoch seconds — the urgency
    /// "reset" anchor.
    int64_t               scheduleModifiedAt = -1;
    /// ONESHOT deadline (= task.deadlineHint). -1 for non-ONESHOT
    /// or for ONESHOT without a due time.
    int64_t               oneshotDeadline   = -1;
    /// Most recent `task_executions.ts` for this task, or -1 if
    /// never run. Drives the "missed / cycle-done" branches of
    /// urgency.
    int64_t               lastExecutionAt   = -1;
};

}  // namespace howler::domain
