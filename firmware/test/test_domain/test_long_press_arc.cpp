#include <unity.h>

#include "../../src/domain/LongPressArc.h"

using howler::domain::LongPressArc;
using Phase = howler::domain::LongPressArc::Phase;

void test_arc_idle_when_not_held() {
    LongPressArc a(600);
    a.update(0, false);
    TEST_ASSERT_EQUAL(static_cast<int>(Phase::Idle), static_cast<int>(a.phase()));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, a.progress());
    a.update(500, false);
    TEST_ASSERT_EQUAL(static_cast<int>(Phase::Idle), static_cast<int>(a.phase()));
}

void test_arc_charges_then_fires() {
    LongPressArc a(600);
    a.update(0, true);
    TEST_ASSERT_EQUAL(static_cast<int>(Phase::Charging), static_cast<int>(a.phase()));
    a.update(300, true);
    TEST_ASSERT_FLOAT_WITHIN(0.05f, 0.5f, a.progress());
    a.update(700, true);
    TEST_ASSERT_EQUAL(static_cast<int>(Phase::Fired), static_cast<int>(a.phase()));
    TEST_ASSERT_EQUAL_FLOAT(1.0f, a.progress());
}

void test_arc_releases_before_threshold_resets() {
    LongPressArc a(600);
    a.update(0, true);
    a.update(200, true);
    TEST_ASSERT_FLOAT_WITHIN(0.05f, 0.333f, a.progress());
    a.update(250, false);
    TEST_ASSERT_EQUAL(static_cast<int>(Phase::Idle), static_cast<int>(a.phase()));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, a.progress());
}
