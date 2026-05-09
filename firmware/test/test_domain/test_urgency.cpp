#include <unity.h>

#include "../../src/domain/Urgency.h"

// Mirrors backend/test/urgency.test.ts. Same constants, same anchor
// timestamp, same expected outputs — slice B lands a line-by-line
// port of `services/urgency.ts` to firmware/src/domain/Urgency.h
// and the easiest way to prove the port is faithful is to run the
// same test cases through it.

using howler::domain::computePrevDeadline;
using howler::domain::computeUrgency;
using howler::domain::ScheduleRule;
using howler::domain::Urgency;
using howler::domain::UrgencyResult;

namespace {

constexpr int64_t HOUR = 3600;
constexpr int64_t DAY  = 86400;
// 2026-05-06 00:00 UTC — same anchor the TS tests use so any
// regression diffs are easy to spot.
constexpr int64_t T0 = 1778025600;

ScheduleRule daily(std::initializer_list<uint16_t> minutes) {
    ScheduleRule r;
    r.kind = ScheduleRule::Kind::Daily;
    r.dailyMinutes.assign(minutes.begin(), minutes.end());
    return r;
}

ScheduleRule periodic(int32_t intervalDays) {
    ScheduleRule r;
    r.kind = ScheduleRule::Kind::Periodic;
    r.intervalDays = intervalDays;
    return r;
}

ScheduleRule oneshot(int32_t cadence = 0) {
    ScheduleRule r;
    r.kind = ScheduleRule::Kind::Oneshot;
    r.intervalDays = cadence;
    return r;
}

}  // namespace

// ── DAILY ─────────────────────────────────────────────────────────

void test_urgency_daily_urgent_in_last_quarter_of_gap() {
    // 3 slots → 8 h between consecutive slots.
    // 7:00 — 1 h before 08:00 deadline, gap = 8 h, ~12 % remains.
    const auto rule = daily({8 * 60, 16 * 60, 0});  // 08:00, 16:00, 00:00
    const auto r = computeUrgency(rule, T0 + 1, /*oneshot=*/-1,
                                  /*lastExec=*/-1, T0 + 7 * HOUR);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Urgent),
                      static_cast<int>(r.tier));
    TEST_ASSERT_FALSE(r.isMissed);
    TEST_ASSERT_EQUAL_INT64(T0 + 8 * HOUR, r.nextDeadline);
}

void test_urgency_daily_non_urgent_in_second_to_last_quarter() {
    // 12:00 — 4 h before 16:00, fraction = 50 %.
    const auto rule = daily({8 * 60, 16 * 60, 0});
    const auto r = computeUrgency(rule, T0 + 8 * HOUR + 1, -1, -1,
                                  T0 + 12 * HOUR);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::NonUrgent),
                      static_cast<int>(r.tier));
    TEST_ASSERT_FALSE(r.isMissed);
}

void test_urgency_daily_hidden_when_more_than_half_remains() {
    // 10:00 — 6 h before 16:00, fraction = 75 %.
    const auto rule = daily({8 * 60, 16 * 60, 0});
    const auto r = computeUrgency(rule, T0 + 8 * HOUR + 1, -1, -1,
                                  T0 + 10 * HOUR);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Hidden),
                      static_cast<int>(r.tier));
}

void test_urgency_daily_urgent_when_previous_slot_missed() {
    // 09:00 — 1 h after 08:00 deadline, never executed since.
    // modifiedAt is yesterday → 08:00 is missed.
    const auto rule = daily({8 * 60, 16 * 60, 0});
    const auto r = computeUrgency(rule, T0 - DAY, -1, -1, T0 + 9 * HOUR);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Urgent),
                      static_cast<int>(r.tier));
    TEST_ASSERT_TRUE(r.isMissed);
    TEST_ASSERT_EQUAL_INT64(T0 + 8 * HOUR, r.prevDeadline);
}

void test_urgency_daily_not_missed_when_modifiedAt_after_prev() {
    // First-expected-execution rule: schedule edited at 08:30 (after
    // the 08:00 slot) → 08:00 is treated as completed.
    const auto rule = daily({8 * 60, 16 * 60, 0});
    const auto r = computeUrgency(rule, T0 + 8 * HOUR + 30 * 60,
                                  -1, -1, T0 + 9 * HOUR);
    TEST_ASSERT_FALSE(r.isMissed);
}

void test_urgency_daily_not_missed_when_executed_after_prev() {
    const auto rule = daily({8 * 60, 16 * 60, 0});
    // Executed 5 min after 08:00.
    const auto r = computeUrgency(rule, T0 - DAY, -1,
                                  T0 + 8 * HOUR + 5 * 60,
                                  T0 + 9 * HOUR);
    TEST_ASSERT_FALSE(r.isMissed);
}

void test_urgency_daily_cycle_done_shifts_window_forward() {
    // [08, 16, 00] gaps. At 15:00 (1 h before 16:00) the row is
    // normally URGENT. Executing at 14:00 (between 08 and 16) shifts
    // urgency to the 16→00 window — 9 h remains of an 8 h gap, so
    // it lands HIDDEN.
    const auto rule = daily({8 * 60, 16 * 60, 0});
    const auto r = computeUrgency(rule, T0 - DAY, -1,
                                  T0 + 14 * HOUR, T0 + 15 * HOUR);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Hidden),
                      static_cast<int>(r.tier));
    TEST_ASSERT_FALSE(r.isMissed);
    TEST_ASSERT_EQUAL_INT64(T0 + 16 * HOUR, r.prevDeadline);
    TEST_ASSERT_EQUAL_INT64(T0 + 24 * HOUR, r.nextDeadline);
}

// ── PERIODIC ──────────────────────────────────────────────────────

void test_urgency_periodic_hidden_early_in_cycle() {
    const auto rule = periodic(3);
    // 1 day after creation → 2 days remain of 3 (~66 %).
    const auto r = computeUrgency(rule, T0, -1, -1, T0 + 1 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Hidden),
                      static_cast<int>(r.tier));
    TEST_ASSERT_EQUAL_INT64(T0 + 3 * DAY, r.nextDeadline);
}

void test_urgency_periodic_non_urgent_in_second_to_last_quarter() {
    const auto rule = periodic(3);
    // 2.0 days in (33 % remains).
    const auto r = computeUrgency(rule, T0, -1, -1, T0 + 2 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::NonUrgent),
                      static_cast<int>(r.tier));
}

void test_urgency_periodic_urgent_in_last_quarter() {
    const auto rule = periodic(3);
    // 2.5 days in (~17 % remains).
    const auto r = computeUrgency(rule, T0, -1, -1,
                                  T0 + 2 * DAY + 12 * HOUR);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Urgent),
                      static_cast<int>(r.tier));
}

void test_urgency_periodic_urgent_and_missed_after_deadline() {
    const auto rule = periodic(3);
    // 4 days in: deadline at T0+3d came and went.
    const auto r = computeUrgency(rule, T0, -1, -1, T0 + 4 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Urgent),
                      static_cast<int>(r.tier));
    TEST_ASSERT_TRUE(r.isMissed);
    TEST_ASSERT_EQUAL_INT64(T0 + 3 * DAY, r.prevDeadline);
    TEST_ASSERT_EQUAL_INT64(T0 + 6 * DAY, r.nextDeadline);
}

void test_urgency_periodic_execution_reverses_missed() {
    const auto rule = periodic(3);
    // Executed 1 hour after the prev deadline.
    const auto r = computeUrgency(rule, T0, -1,
                                  T0 + 3 * DAY + HOUR, T0 + 4 * DAY);
    TEST_ASSERT_FALSE(r.isMissed);
}

// ── ONESHOT ───────────────────────────────────────────────────────

void test_urgency_oneshot_hidden_when_far_away() {
    // 1 day in, deadline at T0+8d → 87 % remains.
    const auto rule = oneshot();
    const auto r = computeUrgency(rule, T0, T0 + 8 * DAY, -1, T0 + 1 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Hidden),
                      static_cast<int>(r.tier));
}

void test_urgency_oneshot_non_urgent_in_second_to_last_quarter() {
    const auto rule = oneshot();
    // 50 % remaining of 8-day period.
    const auto r = computeUrgency(rule, T0, T0 + 8 * DAY, -1, T0 + 4 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::NonUrgent),
                      static_cast<int>(r.tier));
}

void test_urgency_oneshot_urgent_in_last_quarter() {
    const auto rule = oneshot();
    // ~12 % remaining.
    const auto r = computeUrgency(rule, T0, T0 + 8 * DAY, -1, T0 + 7 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Urgent),
                      static_cast<int>(r.tier));
    TEST_ASSERT_FALSE(r.isMissed);
}

void test_urgency_oneshot_urgent_and_missed_past_deadline() {
    const auto rule = oneshot();
    const auto r = computeUrgency(rule, T0, T0 + 1 * DAY, -1, T0 + 2 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Urgent),
                      static_cast<int>(r.tier));
    TEST_ASSERT_TRUE(r.isMissed);
}

void test_urgency_oneshot_hidden_once_executed() {
    const auto rule = oneshot();
    const auto r = computeUrgency(rule, T0, T0 + 8 * DAY,
                                  T0 + 7 * DAY, T0 + 9 * DAY);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Hidden),
                      static_cast<int>(r.tier));
    TEST_ASSERT_FALSE(r.isMissed);
}

void test_urgency_oneshot_hidden_when_deadline_null() {
    const auto rule = oneshot();
    const auto r = computeUrgency(rule, T0, /*deadline=*/-1, -1, T0);
    TEST_ASSERT_EQUAL(static_cast<int>(Urgency::Hidden),
                      static_cast<int>(r.tier));
}

// ── computePrevDeadline ───────────────────────────────────────────

void test_prev_deadline_daily_returns_latest_passed_today() {
    const auto rule = daily({8 * 60, 14 * 60});
    TEST_ASSERT_EQUAL_INT64(T0 + 14 * HOUR,
        computePrevDeadline(rule, T0, T0 + 15 * HOUR));
}

void test_prev_deadline_daily_returns_yesterday_when_no_today_yet() {
    const auto rule = daily({14 * 60});
    TEST_ASSERT_EQUAL_INT64(T0 - DAY + 14 * HOUR,
        computePrevDeadline(rule, T0, T0 + 9 * HOUR));
}

void test_prev_deadline_periodic_returns_null_when_first_in_future() {
    const auto rule = periodic(3);
    TEST_ASSERT_EQUAL_INT64(-1, computePrevDeadline(rule, T0, T0 + 1 * DAY));
}

void test_prev_deadline_periodic_returns_last_anchored() {
    const auto rule = periodic(3);
    TEST_ASSERT_EQUAL_INT64(T0 + 6 * DAY,
        computePrevDeadline(rule, T0, T0 + 7 * DAY));
}
