// Native (host-side) Unity test of the pure domain layer. Runs under
// `pio test -e native` — no Arduino headers, no LVGL, no LCD.
//
// Plan §15 HIL-1 baseline: this is the kind of test that gates every PR.

#include <unity.h>

#include "../../src/domain/OccurrenceList.h"

using howler::domain::Occurrence;
using howler::domain::OccurrenceList;
using howler::domain::OccurrenceStatus;

static Occurrence make(const char* id, uint8_t pri, int64_t due) {
    Occurrence o;
    o.id = id;
    o.title = id;
    o.priority = pri;
    o.dueAt = due;
    o.status = OccurrenceStatus::Pending;
    return o;
}

void test_higher_priority_comes_first() {
    OccurrenceList list;
    list.replace({ make("a", 1, 100), make("b", 3, 200), make("c", 2, 50) });
    const auto& items = list.items();
    TEST_ASSERT_EQUAL_INT(3, items.size());
    TEST_ASSERT_EQUAL_STRING("b", items[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("c", items[1].id.c_str());
    TEST_ASSERT_EQUAL_STRING("a", items[2].id.c_str());
}

void test_equal_priority_breaks_on_due_at() {
    OccurrenceList list;
    list.replace({ make("late", 2, 500), make("early", 2, 100) });
    TEST_ASSERT_EQUAL_STRING("early", list.items()[0].id.c_str());
}

void test_negative_due_is_least_urgent_within_priority() {
    OccurrenceList list;
    list.replace({ make("vague", 2, -1), make("dated", 2, 500) });
    TEST_ASSERT_EQUAL_STRING("dated", list.items()[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("vague", list.items()[1].id.c_str());
}

// Tests are aggregated by `test/test_domain/runner.cpp` — only one
// `main()` per Unity build, so we just expose the test functions
// here and let the runner call RUN_TEST.
