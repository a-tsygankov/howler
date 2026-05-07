#include <unity.h>

#include "../../src/domain/DashboardModel.h"

using howler::domain::DashboardItem;
using howler::domain::DashboardModel;
using howler::domain::TaskId;
using howler::domain::Urgency;

namespace {

DashboardItem make(const char* id, Urgency u, int64_t due, uint8_t pri = 1) {
    DashboardItem d;
    d.id = id;
    d.taskId = TaskId(id);
    d.title = id;
    d.urgency = u;
    d.dueAt = due;
    d.priority = pri;
    d.isMissed = false;
    d.updatedAt = 0;
    return d;
}

}  // namespace

void test_dashboard_urgent_first_then_due() {
    DashboardModel m;
    m.replace({
        make("a", Urgency::NonUrgent, 100),
        make("b", Urgency::Urgent, 200),
        make("c", Urgency::Urgent, 50),
    });
    TEST_ASSERT_EQUAL_size_t(2, m.urgentCount());
    TEST_ASSERT_EQUAL_STRING("c", m.items()[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("b", m.items()[1].id.c_str());
    TEST_ASSERT_EQUAL_STRING("a", m.items()[2].id.c_str());
}

void test_dashboard_negative_due_sorts_last_within_tier() {
    DashboardModel m;
    m.replace({
        make("vague", Urgency::Urgent, -1),
        make("dated", Urgency::Urgent, 500),
    });
    TEST_ASSERT_EQUAL_STRING("dated", m.items()[0].id.c_str());
}

void test_dashboard_cursor_wraps() {
    DashboardModel m;
    m.replace({
        make("a", Urgency::Urgent, 1),
        make("b", Urgency::Urgent, 2),
        make("c", Urgency::Urgent, 3),
    });
    TEST_ASSERT_EQUAL_size_t(0, m.cursor());
    m.moveCursor(2);
    TEST_ASSERT_EQUAL_size_t(2, m.cursor());
    m.moveCursor(1);  // wraps to 0
    TEST_ASSERT_EQUAL_size_t(0, m.cursor());
    m.moveCursor(-1);  // wraps to last
    TEST_ASSERT_EQUAL_size_t(2, m.cursor());
}

void test_dashboard_replace_preserves_cursor_by_id() {
    DashboardModel m;
    m.replace({
        make("a", Urgency::Urgent, 1),
        make("b", Urgency::Urgent, 2),
        make("c", Urgency::Urgent, 3),
    });
    m.moveCursor(1);  // cursor at "b"
    TEST_ASSERT_EQUAL_STRING("b", m.selected()->id.c_str());

    // Replace with a different order; "b" should stay selected.
    m.replace({
        make("c", Urgency::Urgent, 3),
        make("b", Urgency::Urgent, 2),
        make("a", Urgency::Urgent, 1),
    });
    TEST_ASSERT_EQUAL_STRING("b", m.selected()->id.c_str());
}

void test_dashboard_remove_by_id_keeps_cursor_valid() {
    DashboardModel m;
    m.replace({
        make("a", Urgency::Urgent, 1),
        make("b", Urgency::Urgent, 2),
        make("c", Urgency::Urgent, 3),
    });
    m.moveCursor(2);  // cursor at "c"
    m.removeById("c");
    TEST_ASSERT_EQUAL_size_t(2, m.size());
    TEST_ASSERT_EQUAL_size_t(1, m.cursor());
    TEST_ASSERT_EQUAL_STRING("b", m.selected()->id.c_str());
}

void test_dashboard_first_non_urgent_marker() {
    DashboardModel m;
    m.replace({
        make("a", Urgency::Urgent, 1),
        make("b", Urgency::NonUrgent, 2),
        make("c", Urgency::NonUrgent, 3),
    });
    TEST_ASSERT_EQUAL_size_t(1, m.firstNonUrgent());
    TEST_ASSERT_EQUAL_size_t(1, m.urgentCount());
}

// Tests aggregated by `test/test_domain/runner.cpp`.
