#pragma once

// Direct C++ port of `backend/src/services/urgency.ts`. Pure function
// over rule + anchors + nowSec; no clock, no network, no DB. Slice B
// of docs/sync-analysis.md — once the device computes urgency
// locally, the peek-then-fetch sync is sufficient and the 5-min
// stopgap full-refresh in SyncService can retire.
//
// Sentinel convention for "null" int64_t fields (TS `number | null`):
// any value < 0 means "no value". Real epoch seconds are always
// positive, so the test is unambiguous. No std::optional to keep the
// struct trivially-copyable for the host-side tests + cheap to pass.
//
// Logic (line-by-line mirror of urgency.ts; comments preserved so a
// diff between the two implementations stays mechanical):
//
//   - prevDeadline: most recent scheduled deadline strictly < nowSec
//   - nextDeadline: next scheduled deadline > nowSec
//   - period       = next - prev (or intervalDays for PERIODIC)
//   - isMissed     = prev > max(modifiedAt, lastExecutionAt)
//   - tier         = URGENT (≤25 % of period remains)
//                  | NON_URGENT (≤50 %)
//                  | HIDDEN (>50 %)
//   - First-expected-execution rule: modifiedAt > prev → not missed
//   - Cycle-done rule: lastExecutionAt ≥ prev shifts the window to
//     the next cycle (so completing late doesn't hold the row at
//     URGENT until the next slot approaches).

#include "DashboardItem.h"

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

namespace howler::domain {

/// Mirrors backend `ScheduleRule` (shared/schemas.ts §52). Daily
/// times are stored as minute-of-day (0..1439); the wire format
/// "HH:MM" is parsed by parseDailyTime() at deserialization time.
struct ScheduleRule {
    enum class Kind : uint8_t { Daily, Periodic, Oneshot };
    Kind                  kind = Kind::Oneshot;
    /// DAILY only: minute-of-day for each scheduled slot, in any
    /// order (computeNextDeadline sorts a local copy of the
    /// candidate set). Empty for non-DAILY.
    std::vector<uint16_t> dailyMinutes;
    /// PERIODIC: required, > 0. ONESHOT: optional cadence (0 = no
    /// cadence; > 0 = nudge every N days between modifiedAt and the
    /// deadline). DAILY: unused.
    int32_t               intervalDays = 0;
};

struct UrgencyResult {
    Urgency tier             = Urgency::Hidden;
    int64_t prevDeadline     = -1;  // < 0 → null
    int64_t nextDeadline     = -1;
    int64_t periodSec        = -1;
    bool    isMissed         = false;
    int64_t secondsUntilNext = -1;
};

namespace urgency_internal {

constexpr int64_t kDaySec = 24LL * 60LL * 60LL;

inline Urgency tierFromFraction(double fraction) {
    if (fraction <= 0.25) return Urgency::Urgent;
    if (fraction <= 0.50) return Urgency::NonUrgent;
    return Urgency::Hidden;
}

/// Mirrors urgency.ts `computeNextDeadline`. > nowSec for DAILY +
/// PERIODIC; null for ONESHOT (which has its own dedicated path).
inline int64_t computeNextDeadline(const ScheduleRule& rule,
                                   int64_t scheduleModifiedAt,
                                   int64_t nowSec) {
    if (rule.kind == ScheduleRule::Kind::Periodic) {
        const int64_t period = static_cast<int64_t>(rule.intervalDays) * kDaySec;
        if (period <= 0) return -1;
        const int64_t elapsed = nowSec - scheduleModifiedAt;
        if (elapsed < period) return scheduleModifiedAt + period;
        // floor(elapsed / period) + 1
        const int64_t k = (elapsed / period) + 1;
        return scheduleModifiedAt + k * period;
    }
    if (rule.kind == ScheduleRule::Kind::Daily) {
        const int64_t todayStartSec = (nowSec / kDaySec) * kDaySec;
        // Two days of candidates to cover the wrap-past-midnight
        // case (e.g. a "00:00" slot that's smaller-numbered than
        // the current 16:00 slot but represents tomorrow's wake-up
        // call). Sort ascending and pick the first > nowSec — same
        // shape as the TS reference implementation.
        std::vector<int64_t> candidates;
        candidates.reserve(rule.dailyMinutes.size() * 2);
        for (uint16_t mod : rule.dailyMinutes) {
            candidates.push_back(todayStartSec
                                 + static_cast<int64_t>(mod) * 60);
            candidates.push_back(todayStartSec + kDaySec
                                 + static_cast<int64_t>(mod) * 60);
        }
        std::sort(candidates.begin(), candidates.end());
        for (int64_t c : candidates) if (c > nowSec) return c;
        return -1;
    }
    return -1;  // ONESHOT — handled by the dedicated path
}

/// `computeNextDeadlineAfter` from urgency.ts — same as
/// computeNextDeadline but anchored on an arbitrary `after` instead
/// of `nowSec`. Used for the cycle-done shift.
inline int64_t computeNextDeadlineAfter(const ScheduleRule& rule,
                                        int64_t scheduleModifiedAt,
                                        int64_t after) {
    return computeNextDeadline(rule, scheduleModifiedAt, after);
}

}  // namespace urgency_internal

/// Latest scheduled deadline strictly before nowSec, or -1 if none
/// yet. Strict-less-than so a deadline whose time is exactly "now"
/// is the *current* deadline, not the previous one.
inline int64_t computePrevDeadline(const ScheduleRule& rule,
                                   int64_t scheduleModifiedAt,
                                   int64_t nowSec) {
    using namespace urgency_internal;
    if (rule.kind == ScheduleRule::Kind::Oneshot) return -1;
    if (rule.kind == ScheduleRule::Kind::Periodic) {
        const int64_t period = static_cast<int64_t>(rule.intervalDays) * kDaySec;
        if (period <= 0) return -1;
        const int64_t elapsed = nowSec - scheduleModifiedAt;
        if (elapsed <= 0) return -1;
        // ceil(elapsed / period) - 1 — same arithmetic the TS uses.
        const int64_t k = ((elapsed + period - 1) / period) - 1;
        if (k < 1) return -1;
        return scheduleModifiedAt + k * period;
    }
    // DAILY: scan today's + yesterday's slots for the latest one < now.
    const int64_t todayStartSec = (nowSec / kDaySec) * kDaySec;
    int64_t best = -1;
    for (uint16_t mod : rule.dailyMinutes) {
        const int64_t cand = todayStartSec + static_cast<int64_t>(mod) * 60;
        if (cand < nowSec && cand > best) best = cand;
    }
    for (uint16_t mod : rule.dailyMinutes) {
        const int64_t cand = todayStartSec - kDaySec
                             + static_cast<int64_t>(mod) * 60;
        if (cand < nowSec && cand > best) best = cand;
    }
    return best;
}

namespace urgency_internal {

inline UrgencyResult urgencyForOneshot(int64_t deadline,
                                       int64_t modifiedAt,
                                       int64_t lastExecutionAt,
                                       int64_t nowSec,
                                       int32_t intervalDays) {
    UrgencyResult out;
    if (deadline < 0) {
        out.tier = Urgency::Hidden;
        return out;
    }

    // ── ONESHOT with reminder cadence ─────────────────────────────
    if (intervalDays > 0) {
        const int64_t cycle = static_cast<int64_t>(intervalDays) * kDaySec;
        if (nowSec >= deadline) {
            const bool completed =
                lastExecutionAt >= 0 && lastExecutionAt >= modifiedAt;
            out.prevDeadline     = deadline;
            out.periodSec        = cycle;
            if (completed) {
                out.tier = Urgency::Hidden;
                return out;
            }
            out.tier             = Urgency::Urgent;
            out.isMissed         = true;
            out.secondsUntilNext = 0;
            return out;
        }
        // Find the next cadence cycle, capped at the deadline.
        const int64_t elapsed = nowSec - modifiedAt;
        int64_t next;
        int64_t prev;
        if (elapsed <= 0) {
            next = std::min<int64_t>(modifiedAt + cycle, deadline);
            prev = -1;
        } else {
            const int64_t kNext = (elapsed / cycle) + 1;
            next = std::min<int64_t>(modifiedAt + kNext * cycle, deadline);
            // ceil(elapsed/cycle) - 1
            const int64_t kPrev = ((elapsed + cycle - 1) / cycle) - 1;
            prev = kPrev >= 1 ? modifiedAt + kPrev * cycle : -1;
        }
        const int64_t completedRef = lastExecutionAt < 0
            ? modifiedAt
            : std::max<int64_t>(modifiedAt, lastExecutionAt);
        const bool isMissed = prev >= 0 && prev > completedRef;
        out.prevDeadline     = prev;
        out.nextDeadline     = next;
        out.periodSec        = cycle;
        if (isMissed) {
            out.tier             = Urgency::Urgent;
            out.isMissed         = true;
            out.secondsUntilNext = next - nowSec;
            return out;
        }
        const int64_t remaining = next - nowSec;
        const double  fraction  = cycle > 0
            ? static_cast<double>(remaining) / static_cast<double>(cycle)
            : 0.0;
        out.tier             = tierFromFraction(fraction);
        out.secondsUntilNext = remaining;
        return out;
    }

    // ── ONESHOT without cadence — single deadline, no reminders ───
    const int64_t period = std::max<int64_t>(0, deadline - modifiedAt);

    // Already executed (any execution counts — only one due window).
    if (lastExecutionAt >= 0) {
        out.tier         = Urgency::Hidden;
        out.prevDeadline = deadline;
        out.periodSec    = period;
        return out;
    }

    if (nowSec >= deadline) {
        out.tier             = Urgency::Urgent;
        out.prevDeadline     = deadline;
        out.periodSec        = period;
        out.isMissed         = true;
        out.secondsUntilNext = 0;
        return out;
    }

    const int64_t remaining = deadline - nowSec;
    const double  fraction  = period > 0
        ? static_cast<double>(remaining) / static_cast<double>(period)
        : 0.0;
    out.tier             = tierFromFraction(fraction);
    out.nextDeadline     = deadline;
    out.periodSec        = period;
    out.secondsUntilNext = remaining;
    return out;
}

}  // namespace urgency_internal

/// Pure urgency-tier computation. Drop-in equivalent to backend
/// `services/urgency.ts::computeUrgency` — same inputs (with -1
/// playing TS `null`), same outputs.
inline UrgencyResult computeUrgency(const ScheduleRule& rule,
                                    int64_t scheduleModifiedAt,
                                    int64_t oneshotDeadline,
                                    int64_t lastExecutionAt,
                                    int64_t nowSec) {
    using namespace urgency_internal;

    if (rule.kind == ScheduleRule::Kind::Oneshot) {
        return urgencyForOneshot(oneshotDeadline, scheduleModifiedAt,
                                 lastExecutionAt, nowSec, rule.intervalDays);
    }

    const int64_t next = computeNextDeadline(rule, scheduleModifiedAt, nowSec);
    if (next < 0) {
        UrgencyResult out;
        out.tier = Urgency::Hidden;
        return out;
    }
    const int64_t prev = computePrevDeadline(rule, scheduleModifiedAt, nowSec);
    int64_t period;
    if (rule.kind == ScheduleRule::Kind::Periodic) {
        period = static_cast<int64_t>(rule.intervalDays) * kDaySec;
    } else if (prev >= 0) {
        period = next - prev;
    } else {
        // DAILY with no prev slot today — fall back to 24 h, matching
        // the TS implementation's `DAY_SEC` fallback.
        period = kDaySec;
    }

    const int64_t completedReference = lastExecutionAt < 0
        ? scheduleModifiedAt
        : std::max<int64_t>(scheduleModifiedAt, lastExecutionAt);
    const bool isMissed = prev >= 0 && prev > completedReference;

    UrgencyResult out;
    if (isMissed) {
        out.tier             = Urgency::Urgent;
        out.prevDeadline     = prev;
        out.nextDeadline     = next;
        out.periodSec        = period;
        out.isMissed         = true;
        out.secondsUntilNext = next - nowSec;
        return out;
    }

    // Cycle-done: lastExecution after prev → shift the window forward.
    const bool completedThisCycle =
        prev >= 0 && lastExecutionAt >= 0 && lastExecutionAt >= prev;
    if (completedThisCycle) {
        const int64_t nextNext =
            computeNextDeadlineAfter(rule, scheduleModifiedAt, next);
        if (nextNext < 0) {
            out.tier         = Urgency::Hidden;
            out.prevDeadline = next;
            out.periodSec    = period;
            return out;
        }
        const int64_t shiftedPeriod =
            rule.kind == ScheduleRule::Kind::Periodic ? period : nextNext - next;
        const int64_t remaining = nextNext - nowSec;
        const double  fraction  = shiftedPeriod > 0
            ? static_cast<double>(remaining) / static_cast<double>(shiftedPeriod)
            : 0.0;
        out.tier             = tierFromFraction(fraction);
        out.prevDeadline     = next;
        out.nextDeadline     = nextNext;
        out.periodSec        = shiftedPeriod;
        out.secondsUntilNext = remaining;
        return out;
    }

    const int64_t remaining = next - nowSec;
    const double  fraction  = period > 0
        ? static_cast<double>(remaining) / static_cast<double>(period)
        : 0.0;
    out.tier             = tierFromFraction(fraction);
    out.prevDeadline     = prev;
    out.nextDeadline     = next;
    out.periodSec        = period;
    out.secondsUntilNext = remaining;
    return out;
}

/// Parse "HH:MM" → minute-of-day [0..1439]. Returns -1 on any
/// malformed input. Used by the WifiNetwork adapter's dashboard
/// JSON parser to populate ScheduleRule::dailyMinutes from the
/// server's array of strings.
inline int parseDailyTime(const std::string& s) {
    if (s.size() != 5 || s[2] != ':') return -1;
    auto digit = [](char c) -> int {
        return (c >= '0' && c <= '9') ? (c - '0') : -1;
    };
    const int h1 = digit(s[0]), h2 = digit(s[1]);
    const int m1 = digit(s[3]), m2 = digit(s[4]);
    if (h1 < 0 || h2 < 0 || m1 < 0 || m2 < 0) return -1;
    const int h = h1 * 10 + h2;
    const int m = m1 * 10 + m2;
    if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
    return h * 60 + m;
}

}  // namespace howler::domain
