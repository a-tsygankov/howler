#include <unity.h>

#include "../../src/domain/RotaryNav.h"

using howler::domain::RotaryNav;

void test_rotary_wraps() {
    RotaryNav nav(3);
    TEST_ASSERT_EQUAL_size_t(0, nav.cursor());
    nav.onRotate(2);
    TEST_ASSERT_EQUAL_size_t(2, nav.cursor());
    nav.onRotate(1);
    TEST_ASSERT_EQUAL_size_t(0, nav.cursor());  // wraps
    nav.onRotate(-1);
    TEST_ASSERT_EQUAL_size_t(2, nav.cursor());  // wraps backward
}

void test_rotary_clamped_does_not_wrap() {
    RotaryNav nav(3);
    nav.onRotateClamped(5);
    TEST_ASSERT_EQUAL_size_t(2, nav.cursor());
    auto a = nav.onRotateClamped(10);
    // Already at the top, no further movement.
    TEST_ASSERT_EQUAL_size_t(2, nav.cursor());
    TEST_ASSERT_EQUAL(static_cast<int>(RotaryNav::Action::None), static_cast<int>(a));
}

void test_rotary_handles_zero_size() {
    RotaryNav nav(0);
    auto a = nav.onRotate(3);
    TEST_ASSERT_EQUAL(static_cast<int>(RotaryNav::Action::None), static_cast<int>(a));
    TEST_ASSERT_EQUAL_size_t(0, nav.cursor());
}

void test_rotary_setSize_clamps_cursor() {
    RotaryNav nav(10);
    nav.setCursor(7);
    nav.setSize(3);
    TEST_ASSERT_EQUAL_size_t(2, nav.cursor());
}
